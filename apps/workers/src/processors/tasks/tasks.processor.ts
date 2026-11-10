import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { QueueName, notificationPreferencesSchema } from '@hilatech/contracts';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { QueueProducer } from '../../automation/queue-producer.service';
import { WORKERS_ENV } from '../../config/config.module';
import type { WorkersEnv } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../../queue/job-processor';

export const TASK_SCHEDULER_ID = 'task-reminder-tick';
/** Tasks claimed per tick and organization-agnostic page; the next tick (or loop) takes the rest. */
export const REMINDER_BATCH = 200;
const MAX_BATCHES_PER_TICK = 50;

/** Idempotency key of the reminder notification: one per task and `reminderAt` value. */
export function reminderKey(taskId: string, reminderAt: Date): string {
  return `task-reminder:${taskId}:${reminderAt.getTime()}`;
}

export interface ReminderTickResult {
  scanned: number;
  notified: number;
  skipped: number;
}

/**
 * `tasks` queue: the every-minute `reminder_tick` creates ONE in-app `task_reminder` notification per open task whose
 * `reminderAt` has passed. Idempotency has three layers: the claim (`reminderSentAt` set by a conditional update that
 * only one tick can win), the notification's own idempotency key (a retry after a crash never duplicates it), and the
 * reset of `reminderSentAt` when `reminderAt` changes (done by the API). A failed delivery releases the claim.
 */
@Injectable()
export class TasksProcessor implements JobProcessor<typeof QueueName.TASKS>, OnApplicationBootstrap {
  readonly queue = QueueName.TASKS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: QueueProducer,
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    @InjectPinoLogger(TasksProcessor.name) private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.TASK_REMINDER_SCHEDULER_ENABLED) return;
    try {
      await this.producer.queue(QueueName.TASKS).upsertJobScheduler(
        TASK_SCHEDULER_ID,
        { every: 60_000 },
        {
          name: QueueName.TASKS,
          data: {
            kind: 'reminder_tick',
            organizationId: null,
            at: new Date().toISOString(),
            idempotencyKey: 'task-reminder-tick',
            enqueuedAt: new Date().toISOString(),
          },
          opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 }, attempts: 1 },
        },
      );
      this.logger.info({ everyMs: 60_000 }, 'Task reminder scheduler registered');
    } catch (err) {
      this.logger.error({ err }, 'Could not register the task reminder scheduler');
    }
  }

  async process(job: Job<JobPayload<typeof QueueName.TASKS>>, context: JobContext): Promise<JobOutcome> {
    const data = job.data;
    const result = await this.reminderTick(new Date(), data.organizationId, context);
    return { status: 'completed', kind: data.kind, ...result };
  }

  /** Public so integration tests can drive it with a fixed clock. */
  async reminderTick(
    now: Date,
    organizationId: string | null = null,
    context?: Partial<JobContext>,
  ): Promise<ReminderTickResult> {
    const db = this.prisma.client;
    const result: ReminderTickResult = { scanned: 0, notified: 0, skipped: 0 };
    for (let i = 0; i < MAX_BATCHES_PER_TICK; i += 1) {
      const due = await db.task.findMany({
        where: {
          ...(organizationId ? { organizationId } : {}),
          status: { in: ['todo', 'in_progress'] },
          reminderAt: { lte: now },
          reminderSentAt: null,
        },
        orderBy: [{ reminderAt: 'asc' }, { id: 'asc' }],
        take: REMINDER_BATCH,
        select: {
          id: true,
          organizationId: true,
          title: true,
          dueAt: true,
          reminderAt: true,
          assigneeId: true,
          createdById: true,
        },
      });
      if (due.length === 0) break;
      result.scanned += due.length;
      let progressed = 0;
      for (const task of due) {
        if (!task.reminderAt) continue;
        // Claim: only the tick that flips reminderSentAt (for this exact reminderAt) delivers.
        const claim = await db.task.updateMany({
          where: {
            id: task.id,
            organizationId: task.organizationId,
            reminderSentAt: null,
            reminderAt: task.reminderAt,
            status: { in: ['todo', 'in_progress'] },
          },
          data: { reminderSentAt: now },
        });
        if (claim.count === 0) {
          result.skipped += 1;
          continue;
        }
        progressed += 1;
        try {
          const delivered = await this.deliver(task, task.reminderAt);
          if (delivered) result.notified += 1;
          else result.skipped += 1;
        } catch (err) {
          // Release the claim so the next tick retries.
          await db.task
            .updateMany({
              where: { id: task.id, organizationId: task.organizationId, reminderAt: task.reminderAt },
              data: { reminderSentAt: null },
            })
            .catch(() => undefined);
          this.logger.error({ ...context, err, taskId: task.id }, 'Task reminder delivery failed');
          result.skipped += 1;
        }
      }
      if (progressed === 0 || due.length < REMINDER_BATCH) break;
    }
    return result;
  }

  private async deliver(
    task: {
      id: string;
      organizationId: string;
      title: string;
      dueAt: Date | null;
      assigneeId: string | null;
      createdById: string | null;
    },
    reminderAt: Date,
  ): Promise<boolean> {
    const db = this.prisma.client;
    // The assignee is reminded; an unassigned task reminds its creator.
    const recipientId = task.assigneeId ?? task.createdById;
    if (!recipientId) return false;
    const member = await db.organizationMember.findFirst({
      where: { organizationId: task.organizationId, userId: recipientId, status: 'active' },
      select: { user: { select: { id: true, isActive: true, preferences: true } } },
    });
    if (!member || !member.user.isActive) return false;
    const prefs = notificationPreferencesSchema.safeParse(
      (member.user.preferences as { notifications?: unknown } | null)?.notifications ?? {},
    );
    if (prefs.success && prefs.data.inApp?.task_reminder === false) return false;

    const key = reminderKey(task.id, reminderAt);
    const existing = await db.notification.findFirst({
      where: { userId: member.user.id, data: { path: ['idempotencyKey'], equals: key } },
      select: { id: true },
    });
    if (existing) return false;
    await db.notification.create({
      data: {
        organizationId: task.organizationId,
        userId: member.user.id,
        type: 'task_reminder',
        title: task.title.slice(0, 200),
        body: task.dueAt ? `Due ${task.dueAt.toISOString()}` : null,
        link: '/tasks',
        data: { idempotencyKey: key, taskId: task.id },
      },
    });
    return true;
  }
}
