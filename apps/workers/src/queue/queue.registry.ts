import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ALL_QUEUES, type QueueName } from '@hilatech/contracts';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { RedisService } from '../redis/redis.service';
import { createJobHandler } from './job-handler';
import { JOB_PROCESSORS, type AnyJobProcessor, type JobProcessor } from './job-processor';
import { QueueMetricsService } from './queue-metrics.service';
import { resolveWorkerSettings, type WorkerSettings } from './worker-settings';

/**
 * Creates one BullMQ `Worker` per queue in `ALL_QUEUES`, wires each to its processor through
 * `createJobHandler` (payload validation + structured logging) and owns their lifecycle.
 */
@Injectable()
export class QueueRegistry implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly workers = new Map<QueueName, Worker>();
  private readonly processors = new Map<QueueName, AnyJobProcessor>();
  private readonly lastErrorLoggedAt = new Map<QueueName, number>();
  private started = false;

  constructor(
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    private readonly redis: RedisService,
    private readonly metrics: QueueMetricsService,
    @Inject(JOB_PROCESSORS) processors: AnyJobProcessor[],
    @InjectPinoLogger(QueueRegistry.name) private readonly logger: PinoLogger,
  ) {
    for (const processor of processors) {
      if (this.processors.has(processor.queue)) {
        throw new Error(`Duplicate processor registered for queue "${processor.queue}"`);
      }
      this.processors.set(processor.queue, processor);
    }
    const missing = ALL_QUEUES.filter((q) => !this.processors.has(q));
    if (missing.length > 0) {
      throw new Error(`No processor registered for queue(s): ${missing.join(', ')}`);
    }
  }

  onApplicationBootstrap(): void {
    this.start();
  }

  /** Start the metrics collector and one worker per queue. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.metrics.start();
    for (const queue of ALL_QUEUES) {
      const settings = resolveWorkerSettings(queue, this.env.WORKER_CONCURRENCY);
      this.workers.set(queue, this.createWorker(queue, settings));
      this.logger.info({ queue, ...settings, prefix: this.env.BULLMQ_PREFIX }, 'Worker started');
    }
  }

  /** Gracefully close every worker: in-flight jobs finish, no new jobs are picked up. Idempotent. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.logger.info(
      { workers: this.workers.size },
      'Closing workers (waiting for in-flight jobs)',
    );
    const results = await Promise.allSettled([...this.workers.values()].map((w) => w.close()));
    const failures = results.filter((r) => r.status === 'rejected');
    for (const f of failures)
      this.logger.warn({ err: (f as PromiseRejectedResult).reason }, 'Worker close failed');
    this.workers.clear();
    await this.metrics.stop();
    this.logger.info('All workers closed');
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** Queue names with a live worker (for diagnostics/tests). */
  activeQueues(): QueueName[] {
    return [...this.workers.keys()];
  }

  worker(queue: QueueName): Worker | undefined {
    return this.workers.get(queue);
  }

  private createWorker<Q extends QueueName>(queue: Q, settings: WorkerSettings): Worker {
    const processor = this.processors.get(queue) as unknown as JobProcessor<Q>;
    const handler = createJobHandler(queue, processor, this.logger);

    const worker = new Worker(queue, handler, {
      connection: { ...this.redis.connectionOptions },
      prefix: this.env.BULLMQ_PREFIX,
      concurrency: settings.concurrency,
      lockDuration: settings.lockDuration,
      stalledInterval: settings.stalledInterval,
      maxStalledCount: settings.maxStalledCount,
      autorun: true,
    });

    worker.on('completed', (job: Job, result: unknown) => {
      this.logger.debug({ queue, jobId: job.id, result }, 'Worker event: completed');
    });
    worker.on('failed', (job: Job | undefined, err: Error) => {
      const attempts = job?.opts.attempts ?? 1;
      const made = job?.attemptsMade ?? 0;
      const finalFailure = err instanceof UnrecoverableError || made >= attempts;
      this.logger.warn(
        { queue, jobId: job?.id, attemptsMade: made, attempts, finalFailure, reason: err.message },
        finalFailure
          ? 'Worker event: job failed permanently (kept for inspection)'
          : 'Worker event: job failed, retry scheduled',
      );
    });
    worker.on('error', (err: Error) => {
      // Connection/Redis-level errors; BullMQ reconnects on its own. Throttled per queue so an outage
      // does not flood the log with one line per reconnect attempt per worker.
      const now = Date.now();
      if (now - (this.lastErrorLoggedAt.get(queue) ?? 0) > 10_000) {
        this.lastErrorLoggedAt.set(queue, now);
        this.logger.error({ queue, err: { message: err.message, name: err.name } }, 'Worker error');
      }
    });
    worker.on('stalled', (jobId: string) => {
      this.logger.warn({ queue, jobId }, 'Worker event: job stalled');
    });
    worker.on('ready', () => this.logger.debug({ queue }, 'Worker connected to Redis'));
    worker.on('closed', () => this.logger.debug({ queue }, 'Worker closed'));

    return worker;
  }
}
