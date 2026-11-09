import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { DEFAULT_JOB_OPTIONS, QueueName, type DomainEvent } from '@hilatech/contracts';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKERS_ENV } from '../../config/config.module';
import type { WorkersEnv } from '../../config/env.schema';
import { RedisService } from '../../redis/redis.service';

/**
 * Publishes `document.processed` / `document.failed` as `automation` queue `event` jobs — the same
 * payload the API's `DomainEventsService` produces — so workflows and webhook subscriptions can react.
 * Fire-and-forget: emission failures are logged and never fail the document job.
 */
@Injectable()
export class DocumentEvents implements OnApplicationShutdown {
  private queue: Queue | null = null;

  constructor(
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    private readonly redis: RedisService,
    @InjectPinoLogger(DocumentEvents.name) private readonly logger: PinoLogger,
  ) {}

  async emit(
    organizationId: string,
    event: Extract<DomainEvent, 'document.processed' | 'document.failed'>,
    payload: Record<string, unknown>,
    context: { actorUserId?: string | null; requestId?: string },
  ): Promise<void> {
    try {
      this.queue ??= new Queue(QueueName.AUTOMATION, {
        connection: { ...this.redis.connectionOptions },
        prefix: this.env.BULLMQ_PREFIX,
        defaultJobOptions: { ...DEFAULT_JOB_OPTIONS },
      });
      const key = `evt-${event}-${randomUUID()}`;
      await this.queue.add(
        QueueName.AUTOMATION,
        {
          kind: 'event',
          organizationId,
          event,
          payload: { ...payload, organizationId },
          actorUserId: context.actorUserId ?? null,
          idempotencyKey: key,
          requestId: context.requestId,
          enqueuedAt: new Date().toISOString(),
        },
        { jobId: key },
      );
    } catch (error) {
      this.logger.error({ err: error, event, organizationId }, 'Failed to emit domain event');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
  }
}
