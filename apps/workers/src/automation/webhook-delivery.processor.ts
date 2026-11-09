import { Inject, Injectable } from '@nestjs/common';
import { QueueName, WEBHOOK_EVENT_HEADER, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from '@hilatech/contracts';
import {
  SecretBox,
  SsrfError,
  safeRequest,
  signOutboundPayload,
  truncate,
  webhookBackoffMs,
} from '@hilatech/shared';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../queue/job-processor';
import { outboundPolicyFor } from './outbound-policy';
import { QueueProducer } from './queue-producer.service';

type Payload = JobPayload<typeof QueueName.WEBHOOK_DELIVERY>;

export const WEBHOOK_MAX_ATTEMPTS = 5;
const RESPONSE_BODY_CHARS = 2_000;

/**
 * `webhook-delivery` queue: one HTTP delivery attempt of a `WebhookDelivery` row.
 *
 * - body `{ id, event, createdAt, organizationId, data }`, signed `sha256=HMAC(secret, "<ts>.<body>")`
 *   (`x-hilatech-signature`, `x-hilatech-timestamp`, `x-hilatech-event`);
 * - SSRF guard on every attempt (https only, public addresses only — DNS-resolved IPs included — localhost/http
 *   only outside production), timeout, response captured and truncated, redirects never followed;
 * - failures are retried by scheduling a delayed job with exponential backoff (30s, 2m, 10m, 1h) up to
 *   5 attempts, tracked on the row (`attempts`, `nextAttemptAt`, `lastError`); then `failed`.
 *   Policy rejections (private address, scheme) fail immediately — retrying cannot help.
 */
@Injectable()
export class WebhookDeliveryProcessor implements JobProcessor<typeof QueueName.WEBHOOK_DELIVERY> {
  readonly queue = QueueName.WEBHOOK_DELIVERY;
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: QueueProducer,
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    @InjectPinoLogger(WebhookDeliveryProcessor.name) private readonly logger: PinoLogger,
  ) {
    this.box = env.CREDENTIALS_ENCRYPTION_KEY ? new SecretBox(env.CREDENTIALS_ENCRYPTION_KEY) : null;
  }

  async process(job: Job<Payload>, context: JobContext): Promise<JobOutcome> {
    const { organizationId, deliveryId } = job.data;
    const db = this.prisma.client;

    const delivery = await db.webhookDelivery.findFirst({
      where: { id: deliveryId, organizationId },
      include: { webhook: true },
    });
    if (!delivery || delivery.webhook.organizationId !== organizationId) {
      return { status: 'skipped', reason: 'not_found', deliveryId };
    }
    if (delivery.status !== 'pending') {
      return { status: 'skipped', reason: 'already_finished', deliveryId, deliveryStatus: delivery.status };
    }
    // A retry job that fires before the stored schedule (duplicate/stale) must not double-send.
    if (delivery.nextAttemptAt && delivery.nextAttemptAt.getTime() - Date.now() > 2_000) {
      return { status: 'skipped', reason: 'not_due', deliveryId };
    }
    const attemptNumber = delivery.attempts + 1;
    if (job.data.attempt !== delivery.attempts) {
      return { status: 'skipped', reason: 'stale_attempt', deliveryId };
    }

    if (!delivery.webhook.isEnabled) {
      await this.fail(deliveryId, delivery.attempts, 'Webhook subscription is disabled');
      return { status: 'completed', deliveryId, deliveryStatus: 'failed', reason: 'webhook_disabled' };
    }

    let secret: string;
    try {
      if (!this.box) throw new Error('CREDENTIALS_ENCRYPTION_KEY is not configured');
      secret = this.box.decrypt(delivery.webhook.encryptedSecret, organizationId);
    } catch (err) {
      await this.fail(deliveryId, delivery.attempts, `Signing secret unavailable: ${(err as Error).message}`);
      return { status: 'completed', deliveryId, deliveryStatus: 'failed', reason: 'secret_unavailable' };
    }

    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      createdAt: delivery.createdAt.toISOString(),
      organizationId,
      data: delivery.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'HilaTech-Webhooks/1.0',
      [WEBHOOK_SIGNATURE_HEADER]: signOutboundPayload(secret, timestamp, body),
      [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
      [WEBHOOK_EVENT_HEADER]: delivery.event,
      'x-hilatech-delivery': delivery.id,
    };

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    let permanent = false;
    try {
      const res = await safeRequest(delivery.webhook.url, {
        ...outboundPolicyFor(this.env),
        method: 'POST',
        headers,
        body,
        timeoutMs: this.env.WEBHOOK_DELIVERY_TIMEOUT_MS,
        maxResponseBytes: 8 * 1024,
      });
      responseStatus = res.status;
      responseBody = truncate(res.body, RESPONSE_BODY_CHARS);
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (err) {
      if (err instanceof SsrfError) {
        error = `Blocked by the outbound policy: ${err.message}`;
        permanent = err.reason !== 'dns';
      } else {
        error = (err as Error).message || 'Request failed';
      }
    }

    if (!error) {
      await db.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'delivered',
          attempts: attemptNumber,
          responseStatus,
          responseBody,
          lastError: null,
          nextAttemptAt: null,
          deliveredAt: new Date(),
        },
      });
      return { status: 'completed', deliveryId, deliveryStatus: 'delivered', attempts: attemptNumber, responseStatus };
    }

    if (permanent || attemptNumber >= WEBHOOK_MAX_ATTEMPTS) {
      await db.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'failed',
          attempts: attemptNumber,
          responseStatus,
          responseBody,
          lastError: error.slice(0, 500),
          nextAttemptAt: null,
        },
      });
      this.logger.warn({ ...context, deliveryId, attempts: attemptNumber, error }, 'Webhook delivery failed permanently');
      return { status: 'completed', deliveryId, deliveryStatus: 'failed', attempts: attemptNumber, error };
    }

    const delayMs = webhookBackoffMs(attemptNumber);
    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: attemptNumber,
        responseStatus,
        responseBody,
        lastError: error.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + delayMs),
      },
    });
    await this.producer.enqueue(
      QueueName.WEBHOOK_DELIVERY,
      {
        organizationId,
        deliveryId,
        attempt: attemptNumber,
        idempotencyKey: `whd-${deliveryId}-${attemptNumber}`,
        enqueuedAt: new Date().toISOString(),
      },
      { delay: delayMs },
    );
    this.logger.info({ ...context, deliveryId, attempts: attemptNumber, retryInMs: delayMs, error }, 'Webhook delivery will retry');
    return { status: 'completed', deliveryId, deliveryStatus: 'pending', attempts: attemptNumber, retryInMs: delayMs, error };
  }

  private async fail(deliveryId: string, attempts: number, message: string): Promise<void> {
    await this.prisma.client.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'failed', attempts, lastError: message.slice(0, 500), nextAttemptAt: null },
    });
  }
}
