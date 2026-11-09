import { type DomainEvent, QueueName } from '@hilatech/contracts';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Logger } from 'nestjs-pino';

import { QueueService } from '../../infrastructure/queue/queue.service';

export interface EmitContext {
  actorUserId?: string | null;
  requestId?: string | null;
}

const MAX_PAYLOAD_CHARS = 60_000;

/**
 * JSON round trip: Dates become ISO strings, undefined disappears, class instances flatten. Oversized payloads
 * keep only their small fields (ids, statuses) and are marked `truncated`.
 */
function toJsonObject(payload: Record<string, unknown>): Record<string, unknown> {
  const text = JSON.stringify(payload);
  if (text.length <= MAX_PAYLOAD_CHARS) return JSON.parse(text) as Record<string, unknown>;
  const small: Record<string, unknown> = { truncated: true };
  for (const [key, value] of Object.entries(JSON.parse(text) as Record<string, unknown>)) {
    if (JSON.stringify(value).length <= 500) small[key] = value;
  }
  return small;
}

/**
 * Publishes domain events (ADR-015). One `automation.event` job per emission; the workers fan it out to
 * matching workflows and outbound webhook subscriptions. Emitting is fire-and-forget from the caller's
 * point of view: it never throws and never slows the request beyond one Redis round trip.
 */
@Injectable()
export class DomainEventsService {
  constructor(
    private readonly queue: QueueService,
    private readonly logger: Logger,
  ) {}

  async emit(
    organizationId: string,
    event: DomainEvent,
    payload: Record<string, unknown>,
    context: EmitContext = {},
  ): Promise<void> {
    try {
      await this.queue.enqueue(QueueName.AUTOMATION, {
        kind: 'event',
        organizationId,
        event,
        payload: toJsonObject({ ...payload, organizationId }),
        actorUserId: context.actorUserId ?? null,
        idempotencyKey: `evt-${event}-${randomUUID()}`,
        requestId: context.requestId ?? undefined,
        enqueuedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        { err: error, event, organizationId },
        'Failed to emit domain event',
        DomainEventsService.name,
      );
    }
  }
}
