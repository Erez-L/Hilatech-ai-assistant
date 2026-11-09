import type { Prisma, PrismaClient } from '@hilatech/database';
import { monthPeriod } from '@hilatech/shared';

import type { ExecutionFinish, ExecutionStore, StepRecord } from '../orchestrator/types';

/** Cooperative cancellation flag (e.g. a Redis key set by the API's cancel endpoint). */
export interface CancellationSignal {
  isCancelled(executionId: string): Promise<boolean>;
}

export const neverCancelled: CancellationSignal = { isCancelled: async () => false };

/** Round-trip through JSON so Dates/BigInts/undefined become storable values. Callers never pass null. */
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v)),
  ) as Prisma.InputJsonValue;
}

/**
 * Persists `AgentExecution` / `AgentExecutionStep` rows and the `agent_executions` usage metric.
 * Used identically by the API (sync runs) and the workers (async runs).
 */
export class PrismaExecutionStore implements ExecutionStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cancellation: CancellationSignal = neverCancelled,
  ) {}

  async markRunning(executionId: string, startedAt: Date): Promise<void> {
    const execution = await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: { status: 'running', startedAt },
      select: { organizationId: true, triggeredByUserId: true, depth: true },
    });
    const { start, end } = monthPeriod(startedAt);
    await this.prisma.usageRecord.create({
      data: {
        organizationId: execution.organizationId,
        userId: execution.triggeredByUserId,
        metric: 'agent_executions',
        quantity: BigInt(1),
        periodStart: start,
        periodEnd: end,
        metadata: { executionId, depth: execution.depth },
      },
    });
  }

  async addStep(executionId: string, step: StepRecord): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.agentExecutionStep.create({
        data: {
          executionId,
          index: step.index,
          type: step.type,
          name: step.name,
          input: step.input === null || step.input === undefined ? undefined : json(step.input),
          output: step.output === null || step.output === undefined ? undefined : json(step.output),
          status: step.status,
          error: step.error,
          durationMs: step.durationMs,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
        },
      }),
      this.prisma.agentExecution.update({
        where: { id: executionId },
        data: {
          stepCount: step.index + 1,
          ...(step.inputTokens ? { inputTokens: { increment: step.inputTokens } } : {}),
          ...(step.outputTokens ? { outputTokens: { increment: step.outputTokens } } : {}),
        },
      }),
    ]);
  }

  async finish(executionId: string, result: ExecutionFinish): Promise<void> {
    await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        status: result.status,
        output:
          result.output === null || result.output === undefined ? undefined : json(result.output),
        error: result.error,
        stepCount: result.stepCount,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: result.estimatedCostUsd,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
      },
    });
  }

  async createChild(params: Parameters<ExecutionStore['createChild']>[0]): Promise<{ id: string }> {
    const row = await this.prisma.agentExecution.create({
      data: {
        organizationId: params.organizationId,
        agentId: params.agentId,
        parentExecutionId: params.parentExecutionId,
        rootExecutionId: params.rootExecutionId,
        depth: params.depth,
        trigger: 'agent',
        status: 'queued',
        input: json(params.input),
        triggeredByUserId: params.triggeredByUserId,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async isCancelled(executionId: string): Promise<boolean> {
    return this.cancellation.isCancelled(executionId);
  }
}
