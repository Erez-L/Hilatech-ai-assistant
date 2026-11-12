import {
  type EvaluationCheck,
  type EvaluationCheckResult,
  scoreEvaluationCase,
} from '@hilatech/contracts';
import type { Prisma } from '@hilatech/database';
import type { PinoLogger } from 'nestjs-pino';
import { toAgentDefinition } from '../../ai/agent-definition.mapper';
import type { AiRuntime } from '../../ai/ai-runtime';
import { resolveUserPermissions } from '../../ai/user-permissions';
import type { JobContext, JobOutcome } from '../../queue/job-processor';

const MAX_STORED_OUTPUT = 20_000;

/**
 * Executes an evaluation run: one agent execution per case (sequential, so a run never floods the
 * provider), each answer scored against the case's checks. The run is resumable: cases that already
 * have a result are skipped, so a re-delivered job continues where the previous attempt stopped.
 *
 * - The run stops between cases when the API marked it `cancelled`.
 * - The organization's budget hard stop is re-checked before every case; when it is reached the run
 *   ends as `failed` with the budget message and the remaining cases are not executed.
 * - A case whose agent execution does not succeed is recorded as `error` (not as a failed check).
 */
export async function runEvaluation(
  runtime: AiRuntime,
  logger: PinoLogger,
  data: { organizationId: string; targetId: string },
  context: JobContext,
): Promise<JobOutcome> {
  const { organizationId, targetId: runId } = data;
  const prisma = runtime.prisma.client;
  const kind = 'evaluation_run' as const;

  const run = await prisma.evaluationRun.findFirst({
    where: { id: runId, organizationId },
    include: { agent: true, organization: { select: { name: true } } },
  });
  if (!run) {
    logger.warn({ ...context, runId }, 'Evaluation run not found; skipping');
    return { status: 'skipped', reason: 'not_found', kind, runId };
  }
  if (run.status !== 'queued' && run.status !== 'running') {
    return { status: 'skipped', reason: 'already_processed', kind, runId, runStatus: run.status };
  }

  const finish = async (status: 'completed' | 'failed', error: string | null) => {
    const [passed, failed, errored] = await Promise.all(
      (['passed', 'failed', 'error'] as const).map((s) =>
        prisma.evaluationResult.count({ where: { runId, organizationId, status: s } }),
      ),
    );
    // Never overwrite a cancellation that arrived while the last case was running.
    await prisma.evaluationRun.updateMany({
      where: { id: runId, organizationId, status: { in: ['queued', 'running'] } },
      data: { status, error, passed, failed, errored, finishedAt: new Date() },
    });
    return { passed, failed, errored };
  };

  const agent = toAgentDefinition(run.agent);
  if (!agent.isEnabled) {
    await finish('failed', 'Agent is disabled');
    return { status: 'completed', kind, runId, result: { status: 'failed' } };
  }

  await prisma.evaluationRun.updateMany({
    where: { id: runId, organizationId, status: 'queued' },
    data: { status: 'running', startedAt: new Date() },
  });

  const cases = await prisma.evaluationCase.findMany({
    where: { datasetId: run.datasetId, organizationId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  const done = new Set(
    (
      await prisma.evaluationResult.findMany({
        where: { runId, organizationId },
        select: { caseId: true },
      })
    ).map((r) => r.caseId),
  );

  // ADR-010: a human-triggered run never exceeds the human's permissions.
  const userPermissions = run.triggeredByUserId
    ? (await resolveUserPermissions(prisma, organizationId, run.triggeredByUserId)).permissions
    : null;

  for (const testCase of cases) {
    if (done.has(testCase.id)) continue;

    const current = await prisma.evaluationRun.findFirst({
      where: { id: runId, organizationId },
      select: { status: true },
    });
    if (current?.status !== 'running') {
      logger.info({ ...context, runId, runStatus: current?.status }, 'Evaluation run stopped');
      return { status: 'completed', kind, runId, result: { status: current?.status ?? 'gone' } };
    }

    const budget = await runtime.checkBudget(organizationId);
    if (budget.blocked) {
      await finish('failed', budget.message);
      return { status: 'completed', kind, runId, result: { status: 'failed' } };
    }

    const checks = (testCase.checks ?? []) as unknown as EvaluationCheck[];
    const execution = await prisma.agentExecution.create({
      data: {
        organizationId,
        agentId: agent.id,
        trigger: 'manual',
        status: 'queued',
        input: testCase.input,
        triggeredByUserId: run.triggeredByUserId,
      },
      select: { id: true },
    });

    let status: 'passed' | 'failed' | 'error';
    let output: string | null = null;
    let error: string | null = null;
    let checkResults: EvaluationCheckResult[] = checks.map((c) => ({ ...c, passed: false }));
    let durationMs: number | null = null;
    try {
      const result = await runtime.runner.run({
        executionId: execution.id,
        agent,
        input: testCase.input,
        userId: run.triggeredByUserId,
        userPermissions,
        trigger: 'manual',
        depth: 0,
        rootExecutionId: execution.id,
        ancestry: [],
        organizationName: run.organization.name,
      });
      durationMs = result.durationMs;
      output = result.output;
      if (result.status === 'succeeded') {
        const scored = scoreEvaluationCase(checks, result.output ?? '');
        checkResults = scored.checks;
        status = scored.passed ? 'passed' : 'failed';
      } else {
        status = 'error';
        error = result.error ?? `Agent run ${result.status}`;
      }
    } catch (err) {
      status = 'error';
      error = err instanceof Error ? err.message : String(err);
    }

    await prisma.evaluationResult.upsert({
      where: { runId_caseId: { runId, caseId: testCase.id } },
      update: {},
      create: {
        organizationId,
        runId,
        caseId: testCase.id,
        caseName: testCase.name,
        input: testCase.input,
        status,
        output: output === null ? null : output.slice(0, MAX_STORED_OUTPUT),
        error: error === null ? null : error.slice(0, 2000),
        checks: checkResults as unknown as Prisma.InputJsonValue,
        executionId: execution.id,
        durationMs,
      },
    });
    // Live progress for the UI while the run is going.
    await prisma.evaluationRun.updateMany({
      where: { id: runId, organizationId },
      data: {
        ...(status === 'passed' ? { passed: { increment: 1 } } : {}),
        ...(status === 'failed' ? { failed: { increment: 1 } } : {}),
        ...(status === 'error' ? { errored: { increment: 1 } } : {}),
      },
    });
  }

  const totals = await finish('completed', null);
  logger.info({ ...context, runId, ...totals }, 'Evaluation run finished');
  return { status: 'completed', kind, runId, result: { status: 'completed', ...totals } };
}
