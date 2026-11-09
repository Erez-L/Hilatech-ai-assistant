import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ALL_QUEUES, type QueueName } from '@hilatech/contracts';
import { Queue, QueueEvents } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { RedisService } from '../redis/redis.service';
import { withTimeout } from '../common/with-timeout';

/** Live job counts in Redis for one queue. */
export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/** Events observed through the queue's event stream since this process started (all workers). */
export interface QueueEventCounters {
  completed: number;
  failed: number;
  stalled: number;
}

export interface QueueMetrics extends QueueCounts {
  sinceStart: QueueEventCounters;
}

export type QueueMetricsSnapshot = Record<QueueName, QueueMetrics>;

const COUNT_TYPES = ['waiting', 'active', 'completed', 'failed', 'delayed'] as const;

/**
 * Metrics collector: one `QueueEvents` listener per queue feeds in-process counters, one `Queue`
 * handle per queue answers `getJobCounts` for the health endpoint. Nothing here consumes jobs.
 */
@Injectable()
export class QueueMetricsService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  private readonly events = new Map<QueueName, QueueEvents>();
  private readonly counters = new Map<QueueName, QueueEventCounters>();
  private lastErrorLoggedAt = 0;
  private started = false;

  constructor(
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    private readonly redis: RedisService,
    @InjectPinoLogger(QueueMetricsService.name) private readonly logger: PinoLogger,
  ) {
    for (const queue of ALL_QUEUES)
      this.counters.set(queue, { completed: 0, failed: 0, stalled: 0 });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const queue of ALL_QUEUES) {
      const connection = { ...this.redis.connectionOptions };
      this.queues.set(queue, new Queue(queue, { connection, prefix: this.env.BULLMQ_PREFIX }));

      const events = new QueueEvents(queue, {
        connection,
        prefix: this.env.BULLMQ_PREFIX,
        autorun: true,
      });
      const counters = this.counters.get(queue)!;
      events.on('completed', () => void counters.completed++);
      events.on('failed', () => void counters.failed++);
      events.on('stalled', ({ jobId }) => {
        counters.stalled++;
        this.logger.warn(
          { queue, jobId },
          'Job stalled (lock expired) — it will be re-processed or failed',
        );
      });
      events.on('error', (err: Error) => this.logThrottled(queue, err));
      this.events.set(queue, events);
    }
    this.logger.info(
      { queues: ALL_QUEUES.length, prefix: this.env.BULLMQ_PREFIX },
      'Queue metrics collector started',
    );
  }

  eventCounters(queue: QueueName): QueueEventCounters {
    return { ...this.counters.get(queue)! };
  }

  /** Live counts for every queue. Rejects if Redis does not answer within `timeoutMs`. */
  async snapshot(timeoutMs = 3_000): Promise<QueueMetricsSnapshot> {
    const entries = await Promise.all(
      ALL_QUEUES.map(async (queue): Promise<[QueueName, QueueMetrics]> => {
        const handle = this.queues.get(queue);
        if (!handle) throw new Error(`Metrics collector not started (queue "${queue}")`);
        const counts = await withTimeout(
          handle.getJobCounts(...COUNT_TYPES),
          timeoutMs,
          `getJobCounts(${queue})`,
        );
        return [
          queue,
          {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            sinceStart: this.eventCounters(queue),
          },
        ];
      }),
    );
    return Object.fromEntries(entries) as QueueMetricsSnapshot;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    const closers = [
      ...[...this.events.values()].map((e) => e.close()),
      ...[...this.queues.values()].map((q) => q.close()),
    ];
    const results = await Promise.allSettled(closers);
    const failures = results.filter((r) => r.status === 'rejected').length;
    this.events.clear();
    this.queues.clear();
    this.logger.info({ failures }, 'Queue metrics collector stopped');
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  private logThrottled(queue: QueueName, err: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt > 10_000) {
      this.lastErrorLoggedAt = now;
      this.logger.warn({ queue, err: { message: err.message } }, 'QueueEvents connection error');
    }
  }
}
