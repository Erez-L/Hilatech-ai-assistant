import { Injectable } from '@nestjs/common';
import { QueueName, type DomainEvent } from '@hilatech/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { QueueProducer } from './queue-producer.service';

/**
 * Worker-side counterpart of the API's `DomainEventsService`: publishes a domain event as one
 * `automation.event` job (fan-out to workflows and outbound webhooks). Never throws.
 * Use it from processors that produce events (agent runs, document processing).
 */
@Injectable()
export class DomainEventPublisher {
  constructor(
    private readonly producer: QueueProducer,
    @InjectPinoLogger(DomainEventPublisher.name) private readonly logger: PinoLogger,
  ) {}

  async emit(
    organizationId: string,
    event: DomainEvent,
    payload: Record<string, unknown>,
    options: { actorUserId?: string | null; requestId?: string | null } = {},
  ): Promise<void> {
    try {
      const body = JSON.parse(JSON.stringify({ ...payload, organizationId })) as Record<string, unknown>;
      await this.producer.enqueue(QueueName.AUTOMATION, {
        kind: 'event',
        organizationId,
        event,
        payload: body,
        actorUserId: options.actorUserId ?? null,
        idempotencyKey: `evt-${event}-${randomUUID()}`,
        ...(options.requestId ? { requestId: options.requestId } : {}),
        enqueuedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error({ err, event, organizationId }, 'Failed to publish domain event');
    }
  }
}
