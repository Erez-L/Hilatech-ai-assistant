import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  AuditAction,
  QueueName,
  workflowStepResultSchema,
  workflowStepSchema,
  workflowTriggerSchema,
  validateWorkflowDefinition,
  cronIsDue,
  floorToMinute,
  type WorkflowStep,
  type WorkflowStepResult,
  type WorkflowTrigger,
} from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../queue/job-processor';
import { deterministicUuid } from './deterministic-id';
import { QueueProducer } from './queue-producer.service';
import { StepHandlerFactory } from './step-handlers';
import { WorkflowRunner } from './workflow-runner';

type Payload = JobPayload<typeof QueueName.AUTOMATION>;
type ExecuteData = Extract<Payload, { kind: 'execute' }>;
type ResumeData = Extract<Payload, { kind: 'resume' }>;
type EventData = Extract<Payload, { kind: 'event' }>;

/** Minutes re-evaluated on every tick, so a late/skipped tick does not lose a due run (dedupe is by id). */
export const SCHEDULE_CATCH_UP_MINUTES = 5;
export const SCHEDULER_ID = 'automation-schedule-tick';

const stepsSchema = z.array(workflowStepSchema);

export function parseStepResults(value: unknown): WorkflowStepResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const parsed = workflowStepResultSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * `automation` queue.
 *
 * - `execute` / `resume`: run (or continue) a `WorkflowExecution` with the `WorkflowRunner`;
 * - `event`: fan a domain event out to enabled event-triggered workflows and outbound webhook subscriptions;
 * - `schedule_tick`: create executions for cron workflows that are due (organization time zone).
 *
 * Idempotency: fan-out and schedule derive deterministic execution / delivery ids, so a redelivered job
 * creates nothing twice. Disabled workflows never start (queued executions are cancelled) and stop at the next step.
 */
@Injectable()
export class AutomationProcessor
  implements JobProcessor<typeof QueueName.AUTOMATION>, OnApplicationBootstrap
{
  readonly queue = QueueName.AUTOMATION;
  private readonly runner = new WorkflowRunner();

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: QueueProducer,
    private readonly steps: StepHandlerFactory,
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    @InjectPinoLogger(AutomationProcessor.name) private readonly logger: PinoLogger,
  ) {}

  /** Registers the every-minute scheduler (idempotent upsert). */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.AUTOMATION_SCHEDULER_ENABLED) return;
    try {
      await this.producer.queue(QueueName.AUTOMATION).upsertJobScheduler(
        SCHEDULER_ID,
        { every: 60_000 },
        {
          name: QueueName.AUTOMATION,
          data: {
            kind: 'schedule_tick',
            organizationId: null,
            at: new Date().toISOString(),
            idempotencyKey: 'automation-schedule-tick',
            enqueuedAt: new Date().toISOString(),
          },
          opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 }, attempts: 1 },
        },
      );
      this.logger.info({ everyMs: 60_000 }, 'Automation scheduler registered');
    } catch (err) {
      this.logger.error({ err }, 'Could not register the automation scheduler');
    }
  }

  async process(job: Job<Payload>, context: JobContext): Promise<JobOutcome> {
    const data = job.data;
    switch (data.kind) {
      case 'execute':
        return this.execute(data, context);
      case 'resume':
        return this.execute(data, context);
      case 'event':
        return this.fanOut(data, context);
      case 'schedule_tick':
        return this.tick(new Date(), context);
      default: {
        const exhaustive: never = data;
        return exhaustive;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // execute / resume
  // -------------------------------------------------------------------------------------------

  async execute(
    data: ExecuteData | ResumeData,
    context?: Partial<JobContext>,
  ): Promise<JobOutcome> {
    const db = this.prisma.client;
    const { organizationId, executionId } = data;
    const execution = await db.workflowExecution.findFirst({
      where: { id: executionId, organizationId, workflowId: data.workflowId },
      include: {
        workflow: true,
        organization: { select: { id: true, name: true, slug: true, timezone: true } },
      },
    });
    if (!execution) return { status: 'skipped', reason: 'not_found', executionId };
    if (['succeeded', 'failed', 'cancelled'].includes(execution.status)) {
      return {
        status: 'skipped',
        reason: 'already_finished',
        executionId,
        executionStatus: execution.status,
      };
    }
    const workflow = execution.workflow;
    const results = parseStepResults(execution.stepResults);

    if (data.kind === 'resume') {
      if (execution.status !== 'running' || data.fromStepIndex !== results.length) {
        return { status: 'skipped', reason: 'stale_resume', executionId };
      }
    }

    // Disabled workflows never run.
    if (!workflow.isEnabled) {
      await this.finish(execution, 'cancelled', {
        error: 'Workflow is disabled',
        results,
        startedAt: execution.startedAt,
      });
      return {
        status: 'completed',
        executionId,
        executionStatus: 'cancelled',
        reason: 'workflow_disabled',
      };
    }

    // Definition safety net: the API validates before activation, but rows can be edited directly.
    const stepsParsed = stepsSchema.safeParse(workflow.steps);
    const triggerParsed = workflowTriggerSchema.safeParse(workflow.trigger);
    if (!stepsParsed.success || !triggerParsed.success) {
      await this.finish(execution, 'failed', {
        error: 'The stored workflow definition is invalid',
        results,
        startedAt: execution.startedAt ?? new Date(),
      });
      return { status: 'completed', executionId, executionStatus: 'failed' };
    }
    const steps: WorkflowStep[] = stepsParsed.data;
    const issues = validateWorkflowDefinition(triggerParsed.data as WorkflowTrigger, steps);
    if (issues.length > 0) {
      await this.finish(execution, 'failed', {
        error: `Invalid workflow definition: ${issues[0]!.message}`,
        results,
        startedAt: execution.startedAt ?? new Date(),
      });
      return { status: 'completed', executionId, executionStatus: 'failed' };
    }

    // Claim.
    let startedAt = execution.startedAt;
    if (execution.status === 'queued') {
      startedAt = new Date();
      const claimed = await db.workflowExecution.updateMany({
        where: { id: execution.id, status: 'queued' },
        data: { status: 'running', startedAt },
      });
      if (claimed.count !== 1) return { status: 'skipped', reason: 'duplicate', executionId };
      // Raw update on purpose: `updatedAt` marks definition changes (the scheduler uses it as "enabled since")
      // and must not move because of runs.
      await db.$executeRaw`UPDATE "Workflow" SET "runCount" = "runCount" + 1, "lastRunAt" = ${startedAt} WHERE "id" = ${workflow.id}::uuid`;
    } else {
      // Already running: a resume job, or recovery of a crashed attempt. A pending delay must not be cut short.
      const last = results[results.length - 1];
      if (data.kind === 'execute' && last?.type === 'delay') {
        const resumeAt = (last.output as { resumeAt?: string } | null)?.resumeAt;
        if (resumeAt && new Date(resumeAt).getTime() > Date.now()) {
          return { status: 'skipped', reason: 'waiting_for_delay', executionId };
        }
      }
      const claimed = await db.workflowExecution.updateMany({
        where: { id: execution.id, status: 'running', updatedAt: execution.updatedAt },
        data: { attempt: { increment: 1 } },
      });
      if (claimed.count !== 1) return { status: 'skipped', reason: 'concurrent', executionId };
    }

    const trigger = (execution.trigger ?? {}) as Record<string, unknown>;
    const scope = {
      organizationId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      executionId: execution.id,
      createdById: workflow.createdById,
      actorUserId: typeof trigger.actorUserId === 'string' ? trigger.actorUserId : null,
    };
    const outcome = await this.runner.run({
      steps,
      previous: results,
      trigger: { ...trigger, payload: execution.input },
      input: execution.input,
      organization: {
        id: execution.organization.id,
        name: execution.organization.name,
        slug: execution.organization.slug,
        timezone: execution.organization.timezone,
      },
      handlers: this.steps.build(scope),
      persist: async (all) => {
        await db.workflowExecution.update({
          where: { id: execution.id },
          data: { stepResults: all as unknown as Prisma.InputJsonArray },
        });
      },
      scheduleResume: async (seconds, nextIndex) => {
        await this.producer.enqueue(
          QueueName.AUTOMATION,
          {
            kind: 'resume',
            organizationId,
            workflowId: workflow.id,
            executionId: execution.id,
            fromStepIndex: nextIndex,
            idempotencyKey: `wf-resume-${execution.id}-${nextIndex}`,
            enqueuedAt: new Date().toISOString(),
          },
          { delay: seconds * 1000 },
        );
      },
      shouldAbort: async () => {
        const current = await db.workflowExecution.findUnique({
          where: { id: execution.id },
          select: { status: true, workflow: { select: { isEnabled: true } } },
        });
        return !current || current.status !== 'running' || !current.workflow.isEnabled;
      },
    });

    const fresh = { ...execution, startedAt };
    switch (outcome.status) {
      case 'waiting':
        this.logger.info(
          { ...context, executionId, resumeAt: outcome.resumeAt },
          'Workflow waiting on delay',
        );
        return {
          status: 'completed',
          executionId,
          executionStatus: 'running',
          resumeAt: outcome.resumeAt,
        };
      case 'succeeded':
        await this.finish(fresh, 'succeeded', {
          results: outcome.results,
          startedAt,
          output: { vars: outcome.vars },
        });
        return {
          status: 'completed',
          executionId,
          executionStatus: 'succeeded',
          steps: outcome.results.length,
        };
      case 'failed':
        await this.finish(fresh, 'failed', {
          results: outcome.results,
          startedAt,
          error: outcome.error,
        });
        return {
          status: 'completed',
          executionId,
          executionStatus: 'failed',
          error: outcome.error,
        };
      case 'aborted': {
        const current = await db.workflowExecution.findUnique({
          where: { id: execution.id },
          select: { status: true },
        });
        if (current?.status === 'running') {
          await this.finish(fresh, 'cancelled', {
            results: outcome.results,
            startedAt,
            error: 'Workflow was disabled while the execution was running',
          });
        }
        return { status: 'completed', executionId, executionStatus: 'cancelled' };
      }
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  private async finish(
    execution: {
      id: string;
      organizationId: string;
      workflowId: string;
      workflow: { name: string; createdById: string | null };
    },
    status: 'succeeded' | 'failed' | 'cancelled',
    details: {
      results: WorkflowStepResult[];
      startedAt: Date | null;
      error?: string;
      output?: Record<string, unknown>;
    },
  ): Promise<void> {
    const db = this.prisma.client;
    const finishedAt = new Date();
    const startedAt = details.startedAt ?? finishedAt;
    await db.workflowExecution.updateMany({
      where: { id: execution.id, status: { in: ['queued', 'running'] } },
      data: {
        status,
        error: details.error ?? null,
        output: (details.output ?? Prisma.DbNull) as Prisma.InputJsonValue,
        stepResults: details.results as unknown as Prisma.InputJsonArray,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      },
    });
    try {
      await db.auditLog.create({
        data: {
          action: AuditAction.WORKFLOW_EXECUTED,
          organizationId: execution.organizationId,
          actorUserId: null,
          targetType: 'workflow',
          targetId: execution.workflowId,
          metadata: {
            executionId: execution.id,
            workflowName: execution.workflow.name,
            status,
            steps: details.results.length,
            ...(details.error ? { error: details.error.slice(0, 500) } : {}),
          },
        },
      });
      if (status === 'failed' && execution.workflow.createdById) {
        const member = await db.organizationMember.findFirst({
          where: {
            organizationId: execution.organizationId,
            userId: execution.workflow.createdById,
            status: 'active',
          },
          select: { userId: true },
        });
        if (member) {
          await db.notification.create({
            data: {
              organizationId: execution.organizationId,
              userId: member.userId,
              type: 'automation_failed',
              title: `Workflow failed: ${execution.workflow.name}`.slice(0, 200),
              body: details.error?.slice(0, 500) ?? null,
              link: `/automations/executions/${execution.id}`,
              data: { workflowId: execution.workflowId, executionId: execution.id },
            },
          });
        }
      }
    } catch (err) {
      this.logger.error(
        { err, executionId: execution.id },
        'Failed to write workflow completion records',
      );
    }
  }

  // -------------------------------------------------------------------------------------------
  // event fan-out
  // -------------------------------------------------------------------------------------------

  async fanOut(data: EventData, context?: Partial<JobContext>): Promise<JobOutcome> {
    const db = this.prisma.client;
    const { organizationId, event } = data;

    const workflows = await db.workflow.findMany({
      where: {
        organizationId,
        isEnabled: true,
        AND: [
          { trigger: { path: ['type'], equals: 'event' } },
          { trigger: { path: ['event'], equals: event } },
        ],
      },
      select: { id: true },
    });
    let executions = 0;
    for (const workflow of workflows) {
      const id = deterministicUuid('evt-exec', data.idempotencyKey, workflow.id);
      try {
        await db.workflowExecution.create({
          data: {
            id,
            organizationId,
            workflowId: workflow.id,
            status: 'queued',
            trigger: { type: 'event', event, actorUserId: data.actorUserId ?? null },
            input: data.payload as Prisma.InputJsonObject,
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      await this.producer.enqueue(QueueName.AUTOMATION, {
        kind: 'execute',
        organizationId,
        workflowId: workflow.id,
        executionId: id,
        idempotencyKey: `wf-exec-${id}`,
        ...(data.requestId ? { requestId: data.requestId } : {}),
        enqueuedAt: new Date().toISOString(),
      });
      executions += 1;
    }

    const webhooks = await db.webhook.findMany({
      where: { organizationId, isEnabled: true, events: { has: event } },
      select: { id: true },
    });
    let deliveries = 0;
    for (const webhook of webhooks) {
      const id = deterministicUuid('evt-whd', data.idempotencyKey, webhook.id);
      try {
        await db.webhookDelivery.create({
          data: {
            id,
            organizationId,
            webhookId: webhook.id,
            event,
            payload: data.payload as Prisma.InputJsonObject,
            status: 'pending',
            nextAttemptAt: new Date(),
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      await this.producer.enqueue(QueueName.WEBHOOK_DELIVERY, {
        organizationId,
        deliveryId: id,
        attempt: 0,
        idempotencyKey: `whd-${id}-0`,
        ...(data.requestId ? { requestId: data.requestId } : {}),
        enqueuedAt: new Date().toISOString(),
      });
      deliveries += 1;
    }
    this.logger.info({ ...context, event, executions, deliveries }, 'Domain event fanned out');
    return { status: 'completed', event, executions, deliveries };
  }

  // -------------------------------------------------------------------------------------------
  // schedule tick
  // -------------------------------------------------------------------------------------------

  /** Creates executions for cron workflows due in the last few minutes. Exposed for tests (inject `now`). */
  async tick(now: Date, context?: Partial<JobContext>): Promise<JobOutcome> {
    const db = this.prisma.client;
    const current = floorToMinute(now);
    const minutes = Array.from(
      { length: SCHEDULE_CATCH_UP_MINUTES },
      (_, i) => new Date(current.getTime() - (SCHEDULE_CATCH_UP_MINUTES - 1 - i) * 60_000),
    );
    const workflows = await db.workflow.findMany({
      where: {
        isEnabled: true,
        trigger: { path: ['type'], equals: 'schedule' },
        organization: { deletedAt: null },
      },
      include: { organization: { select: { timezone: true } } },
    });
    let created = 0;
    for (const workflow of workflows) {
      const trigger = workflowTriggerSchema.safeParse(workflow.trigger);
      if (!trigger.success || trigger.data.type !== 'schedule') continue;
      const enabledSince = floorToMinute(workflow.updatedAt).getTime();
      for (const minute of minutes) {
        // Never fire for minutes before the workflow was (last) saved/enabled.
        if (minute.getTime() <= enabledSince) continue;
        let due = false;
        try {
          due = cronIsDue(trigger.data.cron, minute, workflow.organization.timezone || 'UTC');
        } catch {
          continue;
        }
        if (!due) continue;
        const id = deterministicUuid('sched-exec', workflow.id, minute.toISOString());
        let isNew = true;
        try {
          await db.workflowExecution.create({
            data: {
              id,
              organizationId: workflow.organizationId,
              workflowId: workflow.id,
              status: 'queued',
              trigger: {
                type: 'schedule',
                cron: trigger.data.cron,
                scheduledFor: minute.toISOString(),
              },
              input: {},
            },
          });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          isNew = false;
        }
        if (!isNew) {
          // Created by an earlier tick; only re-enqueue if that tick died before enqueueing (still queued).
          const existing = await db.workflowExecution.findUnique({
            where: { id },
            select: { status: true },
          });
          if (existing?.status !== 'queued') continue;
        }
        await this.producer.enqueue(QueueName.AUTOMATION, {
          kind: 'execute',
          organizationId: workflow.organizationId,
          workflowId: workflow.id,
          executionId: id,
          idempotencyKey: `wf-exec-${id}`,
          enqueuedAt: new Date().toISOString(),
        });
        created += 1;
      }
    }
    this.logger.debug(
      { ...context, workflows: workflows.length, created },
      'Schedule tick evaluated',
    );
    return { status: 'completed', evaluated: workflows.length, scheduled: created };
  }
}
