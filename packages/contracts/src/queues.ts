import { z } from 'zod';
import { idSchema } from './common';

/**
 * BullMQ queue names and job payload contracts shared by the API (producer) and workers (consumers).
 * Every job payload carries `organizationId` so workers always operate inside a tenant boundary,
 * and `idempotencyKey` so retries and duplicate enqueues are safe.
 */
export const QueueName = {
  DOCUMENT_PROCESSING: 'document-processing',
  EMBEDDINGS: 'embeddings',
  AI_TASKS: 'ai-tasks',
  NOTIFICATIONS: 'notifications',
  EMAIL: 'email',
  AUTOMATION: 'automation',
  ANALYTICS: 'analytics',
  WEBHOOK_DELIVERY: 'webhook-delivery',
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];
export const ALL_QUEUES: readonly QueueName[] = Object.values(QueueName);

const baseJobSchema = z.object({
  organizationId: idSchema.nullable(),
  idempotencyKey: z.string().min(8).max(200),
  requestId: z.string().optional(),
  enqueuedAt: z.string().datetime(),
});

export const emailJobSchema = baseJobSchema.extend({
  to: z.string().email(),
  template: z.enum([
    'verify_email',
    'password_reset',
    'invitation',
    'notification_digest',
    'generic',
  ]),
  variables: z.record(z.string(), z.unknown()),
});
export type EmailJob = z.infer<typeof emailJobSchema>;

export const notificationJobSchema = baseJobSchema.extend({
  userId: idSchema,
  type: z.string(),
  title: z.string(),
  body: z.string().optional(),
  link: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type NotificationJob = z.infer<typeof notificationJobSchema>;

export const documentProcessingJobSchema = baseJobSchema.extend({
  organizationId: idSchema,
  documentId: idSchema,
  knowledgeBaseId: idSchema,
});
export type DocumentProcessingJob = z.infer<typeof documentProcessingJobSchema>;

export const embeddingsJobSchema = baseJobSchema.extend({
  organizationId: idSchema,
  documentId: idSchema,
  chunkIds: z.array(idSchema).min(1),
});
export type EmbeddingsJob = z.infer<typeof embeddingsJobSchema>;

export const aiTaskJobSchema = baseJobSchema.extend({
  organizationId: idSchema,
  kind: z.enum(['conversation_summary', 'agent_execution', 'lead_enrichment']),
  targetId: idSchema,
  requestedByUserId: idSchema.nullable(),
});
export type AiTaskJob = z.infer<typeof aiTaskJobSchema>;

/**
 * Automation queue payloads:
 *  - `execute`: run a queued WorkflowExecution (created by the API for manual runs / inbound webhooks, or by the
 *    workers' fan-out for events and schedules);
 *  - `event`: a domain event happened — fan out to matching workflows and outbound webhook subscriptions;
 *  - `schedule_tick`: evaluate cron-triggered workflows (repeatable job, every minute);
 *  - `resume`: continue an execution after a `delay` step.
 */
export const automationJobSchema = z.discriminatedUnion('kind', [
  baseJobSchema.extend({
    kind: z.literal('execute'),
    organizationId: idSchema,
    workflowId: idSchema,
    executionId: idSchema,
  }),
  baseJobSchema.extend({
    kind: z.literal('event'),
    organizationId: idSchema,
    event: z.string().min(1).max(80),
    payload: z.record(z.string(), z.unknown()),
    actorUserId: idSchema.nullable().default(null),
  }),
  baseJobSchema.extend({
    kind: z.literal('schedule_tick'),
    organizationId: idSchema.nullable(),
    at: z.string().datetime(),
  }),
  baseJobSchema.extend({
    kind: z.literal('resume'),
    organizationId: idSchema,
    workflowId: idSchema,
    executionId: idSchema,
    fromStepIndex: z.number().int().nonnegative(),
  }),
]);
export type AutomationJob = z.infer<typeof automationJobSchema>;

export const analyticsJobSchema = baseJobSchema.extend({
  kind: z.enum(['daily_rollup', 'usage_rollup']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type AnalyticsJob = z.infer<typeof analyticsJobSchema>;

/** Delivers one `WebhookDelivery` row (the row holds event, payload and the target webhook). */
export const webhookDeliveryJobSchema = baseJobSchema.extend({
  organizationId: idSchema,
  deliveryId: idSchema,
  attempt: z.number().int().nonnegative().default(0),
});
export type WebhookDeliveryJob = z.infer<typeof webhookDeliveryJobSchema>;

export const JOB_SCHEMAS = {
  [QueueName.EMAIL]: emailJobSchema,
  [QueueName.NOTIFICATIONS]: notificationJobSchema,
  [QueueName.DOCUMENT_PROCESSING]: documentProcessingJobSchema,
  [QueueName.EMBEDDINGS]: embeddingsJobSchema,
  [QueueName.AI_TASKS]: aiTaskJobSchema,
  [QueueName.AUTOMATION]: automationJobSchema,
  [QueueName.ANALYTICS]: analyticsJobSchema,
  [QueueName.WEBHOOK_DELIVERY]: webhookDeliveryJobSchema,
} as const;

/** Default BullMQ job options per queue. Exponential backoff; failed jobs are kept for inspection. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;
