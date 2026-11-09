import { z } from 'zod';
import { idSchema, paginationQuerySchema, timestampsSchema } from './common';
import { LeadStatus } from './crm';

// ---------------------------------------------------------------------------
// Domain events (what workflows can listen to and outbound webhooks can subscribe to)
// ---------------------------------------------------------------------------

export const DomainEvent = z.enum([
  'lead.created',
  'lead.status_changed',
  'lead.assigned',
  'lead.converted',
  'contact.created',
  'conversation.created',
  'conversation.message_received',
  'conversation.assigned',
  'conversation.resolved',
  'document.processed',
  'document.failed',
  'agent.execution_completed',
  'agent.execution_failed',
  'member.joined',
]);
export type DomainEvent = z.infer<typeof DomainEvent>;
export const ALL_DOMAIN_EVENTS: readonly DomainEvent[] = DomainEvent.options;

// ---------------------------------------------------------------------------
// Workflow triggers
// ---------------------------------------------------------------------------

export const workflowTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({ type: z.literal('event'), event: DomainEvent }),
  /** 5-field cron expression evaluated in the organization's timezone. */
  z.object({
    type: z.literal('schedule'),
    cron: z
      .string()
      .trim()
      .regex(/^(\S+\s+){4}\S+$/, 'cron must have 5 fields'),
  }),
  /** Fired by an inbound webhook endpoint bound to this workflow. */
  z.object({ type: z.literal('webhook') }),
]);
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>;

// ---------------------------------------------------------------------------
// Workflow steps
// ---------------------------------------------------------------------------

/**
 * Step configs may reference the run context with `{{ path }}` templates, e.g. `{{ trigger.payload.leadId }}`
 * or `{{ steps.<stepId>.output.text }}`.
 */
const templateString = z.string().max(20_000);

export const workflowStepSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal('agent_run'),
    agentId: idSchema,
    input: templateString,
    /** Wait for the agent to finish (true) or just enqueue it (false). */
    wait: z.boolean().default(true),
  }),
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal('send_notification'),
    /** `assignee` resolves the lead/conversation assignee from the trigger payload; `user` targets a specific user. */
    to: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('user'), userId: idSchema }),
      z.object({ kind: z.literal('assignee') }),
      z.object({ kind: z.literal('role'), roleKey: z.string().min(1).max(50) }),
    ]),
    title: templateString,
    body: templateString.optional(),
    link: templateString.optional(),
  }),
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal('http_request'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: templateString,
    headers: z.record(z.string(), templateString).default({}),
    body: templateString.optional(),
    timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
  }),
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal('update_lead'),
    leadId: templateString,
    status: LeadStatus.optional(),
    assigneeId: templateString.optional(),
    addTags: z.array(z.string().min(1).max(40)).max(10).default([]),
  }),
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal('create_lead_note'),
    leadId: templateString,
    body: templateString,
  }),
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal('delay'),
    seconds: z.number().int().min(1).max(86_400),
  }),
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal('condition'),
    /** Left operand template, operator, right operand template. */
    left: templateString,
    operator: z.enum(['eq', 'neq', 'contains', 'gt', 'lt', 'exists']),
    right: templateString.optional(),
    /** Step ids to run when true / false (must reference steps later in the list). */
    then: z.array(z.string()).default([]),
    else: z.array(z.string()).default([]),
  }),
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal('n8n_trigger'),
    /** n8n webhook path or full URL; uses the organization's n8n integration. */
    webhook: templateString,
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    id: z.string().trim().min(1).max(40),
    type: z.literal('outbound_webhook'),
    event: z.string().trim().min(1).max(80),
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
]);
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const workflowSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    name: z.string(),
    description: z.string().nullable(),
    isEnabled: z.boolean(),
    trigger: workflowTriggerSchema,
    steps: z.array(workflowStepSchema),
    runCount: z.number().int().nonnegative(),
    lastRunAt: z.string().datetime().nullable(),
    createdById: idSchema.nullable(),
  })
  .merge(timestampsSchema);
export type Workflow = z.infer<typeof workflowSchema>;

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  isEnabled: z.boolean().default(true),
  trigger: workflowTriggerSchema,
  steps: z.array(workflowStepSchema).min(1).max(30),
});
export type CreateWorkflowRequest = z.infer<typeof createWorkflowSchema>;
export const updateWorkflowSchema = createWorkflowSchema.partial();
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowSchema>;

export const listWorkflowsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  isEnabled: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  triggerType: z.enum(['manual', 'event', 'schedule', 'webhook']).optional(),
});
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;

export const runWorkflowSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});
export type RunWorkflowRequest = z.infer<typeof runWorkflowSchema>;

export const WorkflowRunStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;

export const workflowStepResultSchema = z.object({
  stepId: z.string(),
  type: z.string(),
  status: z.enum(['succeeded', 'failed', 'skipped']),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
});
export type WorkflowStepResult = z.infer<typeof workflowStepResultSchema>;

export const workflowExecutionSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    workflowId: idSchema,
    workflow: z.object({ id: idSchema, name: z.string() }).nullable(),
    status: WorkflowRunStatus,
    trigger: z.record(z.string(), z.unknown()),
    input: z.unknown(),
    output: z.unknown().nullable(),
    error: z.string().nullable(),
    stepResults: z.array(workflowStepResultSchema),
    attempt: z.number().int().positive(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nullable(),
  })
  .merge(timestampsSchema);
export type WorkflowExecution = z.infer<typeof workflowExecutionSchema>;

export const listWorkflowExecutionsQuerySchema = paginationQuerySchema.extend({
  workflowId: idSchema.optional(),
  status: WorkflowRunStatus.optional(),
});
export type ListWorkflowExecutionsQuery = z.infer<typeof listWorkflowExecutionsQuerySchema>;

// ---------------------------------------------------------------------------
// Inbound webhook endpoints (trigger workflows)
// ---------------------------------------------------------------------------

export const webhookEndpointSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    workflowId: idSchema.nullable(),
    name: z.string(),
    slug: z.string(),
    isEnabled: z.boolean(),
    receivedCount: z.number().int().nonnegative(),
    lastReceivedAt: z.string().datetime().nullable(),
    /** Public URL path clients post to: /api/v1/hooks/:organizationSlug/:slug */
    path: z.string(),
  })
  .merge(timestampsSchema);
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

/** The raw secret is returned exactly once, on creation (and on rotate). */
export const webhookEndpointWithSecretSchema = webhookEndpointSchema.extend({ secret: z.string() });
export type WebhookEndpointWithSecret = z.infer<typeof webhookEndpointWithSecretSchema>;

export const createWebhookEndpointSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
  workflowId: idSchema.optional(),
  isEnabled: z.boolean().default(true),
});
export type CreateWebhookEndpointRequest = z.infer<typeof createWebhookEndpointSchema>;
export const updateWebhookEndpointSchema = createWebhookEndpointSchema.omit({ slug: true }).partial();
export type UpdateWebhookEndpointRequest = z.infer<typeof updateWebhookEndpointSchema>;

// ---------------------------------------------------------------------------
// Outbound webhooks (subscriptions) and deliveries
// ---------------------------------------------------------------------------

export const webhookSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    url: z.string().url(),
    description: z.string().nullable(),
    events: z.array(DomainEvent),
    secretLast4: z.string(),
    isEnabled: z.boolean(),
  })
  .merge(timestampsSchema);
export type Webhook = z.infer<typeof webhookSchema>;
export const webhookWithSecretSchema = webhookSchema.extend({ secret: z.string() });
export type WebhookWithSecret = z.infer<typeof webhookWithSecretSchema>;

export const createWebhookSchema = z.object({
  url: z.string().trim().url().refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), {
    message: 'Webhook URLs must use https (http allowed only for localhost)',
  }),
  description: z.string().trim().max(500).optional(),
  events: z.array(DomainEvent).min(1).max(ALL_DOMAIN_EVENTS.length),
  isEnabled: z.boolean().default(true),
});
export type CreateWebhookRequest = z.infer<typeof createWebhookSchema>;
export const updateWebhookSchema = createWebhookSchema.partial();
export type UpdateWebhookRequest = z.infer<typeof updateWebhookSchema>;

export const WebhookDeliveryStatus = z.enum(['pending', 'delivered', 'failed']);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatus>;

export const webhookDeliverySchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    webhookId: idSchema,
    event: z.string(),
    payload: z.record(z.string(), z.unknown()),
    status: WebhookDeliveryStatus,
    attempts: z.number().int().nonnegative(),
    responseStatus: z.number().int().nullable(),
    lastError: z.string().nullable(),
    nextAttemptAt: z.string().datetime().nullable(),
    deliveredAt: z.string().datetime().nullable(),
  })
  .merge(timestampsSchema);
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const listWebhookDeliveriesQuerySchema = paginationQuerySchema.extend({
  status: WebhookDeliveryStatus.optional(),
  event: z.string().trim().max(80).optional(),
});
export type ListWebhookDeliveriesQuery = z.infer<typeof listWebhookDeliveriesQuerySchema>;

/** Header carrying the HMAC-SHA256 signature of the raw body: `sha256=<hex>`. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-hilatech-signature' as const;
export const WEBHOOK_TIMESTAMP_HEADER = 'x-hilatech-timestamp' as const;
export const WEBHOOK_EVENT_HEADER = 'x-hilatech-event' as const;
