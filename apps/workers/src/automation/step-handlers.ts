import { Inject, Injectable } from '@nestjs/common';
import {
  AuditAction,
  QueueName,
  integrationConfigSchema,
  integrationSecretsSchema,
  notificationPreferencesSchema,
  renderDeep,
  type IntegrationSecrets,
  type WorkflowStep,
} from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import {
  SecretBox,
  SsrfError,
  buildN8nHeaders,
  isSafeAppPath,
  joinUrl,
  safeRequest,
  truncate,
  type SafeResponse,
} from '@hilatech/shared';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AiRuntime } from '../ai/ai-runtime';
import { toAgentDefinition } from '../ai/agent-definition.mapper';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { deterministicUuid } from './deterministic-id';
import { outboundPolicyFor } from './outbound-policy';
import { QueueProducer } from './queue-producer.service';
import {
  StepError,
  type StepHandler,
  type StepHandlers,
  type StepRuntime,
} from './workflow-runner';

/** Facts about the execution the handlers act within. Every query below filters by `organizationId`. */
export interface ExecutionScope {
  organizationId: string;
  workflowId: string;
  workflowName: string;
  executionId: string;
  /** Workflow creator (used as the note author fallback). */
  createdById: string | null;
  /** Human that started the run (manual runs), if any. */
  actorUserId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_BODY_LIMIT = 64 * 1024;
const OUTPUT_BODY_CHARS = 8_000;

type StepOf<T extends WorkflowStep['type']> = Extract<WorkflowStep, { type: T }>;

function payloadOf(runtime: StepRuntime): Record<string, unknown> {
  const p = (runtime.context.trigger as Record<string, unknown>).payload;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function isJsonContent(headers: Record<string, string>): boolean {
  return /json/i.test(headers['content-type'] ?? '');
}

/** Maps a transport/HTTP failure to a `StepError` (retryable for network problems, 5xx and 429). */
function httpFailure(error: unknown): StepError {
  if (error instanceof SsrfError) {
    return new StepError(`Request blocked by the outbound policy: ${error.message}`, {
      retryable: error.reason === 'dns',
    });
  }
  const e = error as Error;
  return new StepError(e.message || 'Request failed', { retryable: true });
}

function responseOutput(res: SafeResponse): Record<string, unknown> {
  const body =
    res.body.length > OUTPUT_BODY_CHARS ? res.body.slice(0, OUTPUT_BODY_CHARS) : res.body;
  let json: unknown;
  if (isJsonContent(res.headers) && !res.truncated) {
    try {
      json = JSON.parse(res.body);
    } catch {
      json = undefined;
    }
  }
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    contentType: res.headers['content-type'] ?? null,
    body,
    truncated: res.truncated || res.body.length > OUTPUT_BODY_CHARS,
    ...(json !== undefined ? { json } : {}),
    durationMs: res.durationMs,
  };
}

function assertSuccess(res: SafeResponse): Record<string, unknown> {
  const output = responseOutput(res);
  if (res.status >= 200 && res.status < 300) return output;
  const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
  throw new StepError(`HTTP ${res.status}`, { retryable, output });
}

/**
 * Builds the per-execution step handlers. All writes are scoped by `organizationId`; a workflow can never
 * touch another tenant's rows even if a template renders a foreign id (queries simply find nothing).
 */
@Injectable()
export class StepHandlerFactory {
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: QueueProducer,
    private readonly runtime: AiRuntime,
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    @InjectPinoLogger(StepHandlerFactory.name) private readonly logger: PinoLogger,
  ) {
    this.box = env.CREDENTIALS_ENCRYPTION_KEY
      ? new SecretBox(env.CREDENTIALS_ENCRYPTION_KEY)
      : null;
  }

  build(scope: ExecutionScope): StepHandlers {
    return {
      send_notification: (s, r) => this.sendNotification(scope, s, r),
      http_request: (s, r) => this.httpRequest(s, r),
      update_lead: (s, r) => this.updateLead(scope, s, r),
      create_lead_note: (s, r) => this.createLeadNote(scope, s, r),
      create_task: (s, r) => this.createTask(scope, s, r),
      n8n_trigger: (s, r) => this.n8nTrigger(scope, s, r),
      outbound_webhook: (s, r) => this.outboundWebhook(scope, s, r),
      agent_run: (s, r) => this.agentRun(scope, s, r),
    } satisfies Record<string, StepHandler<never>> as unknown as StepHandlers;
  }

  // -------------------------------------------------------------------------------------------
  // send_notification
  // -------------------------------------------------------------------------------------------

  private async sendNotification(
    scope: ExecutionScope,
    step: StepOf<'send_notification'>,
    runtime: StepRuntime,
  ): Promise<unknown> {
    const { organizationId } = scope;
    const db = this.prisma.client;
    let userIds: string[] = [];

    if (step.to.kind === 'user') {
      const member = await db.organizationMember.findFirst({
        where: { organizationId, userId: step.to.userId, status: 'active' },
        select: { userId: true },
      });
      if (!member) throw new StepError('Recipient is not an active member of this organization');
      userIds = [member.userId];
    } else if (step.to.kind === 'role') {
      const members = await db.organizationMember.findMany({
        where: { organizationId, status: 'active', role: { key: step.to.roleKey, organizationId } },
        select: { userId: true },
      });
      userIds = members.map((m) => m.userId);
    } else {
      const assignee = await this.resolveAssignee(organizationId, payloadOf(runtime));
      if (assignee) userIds = [assignee];
      else return { delivered: 0, reason: 'no_assignee', userIds: [] };
    }

    const title = truncate(runtime.render(step.title), 200);
    if (!title.trim()) throw new StepError('Notification title rendered empty');
    const body = step.body ? runtime.render(step.body) : null;
    let link = step.link ? runtime.render(step.link) : null;
    if (link && !isSafeAppPath(link)) link = null; // same-origin app-relative links only (no //host, no /\host)

    const users = await db.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true, preferences: true },
    });
    let delivered = 0;
    const deliveredTo: string[] = [];
    for (const user of users) {
      const prefs = notificationPreferencesSchema.safeParse(
        (user.preferences as { notifications?: unknown } | null)?.notifications ?? {},
      );
      if (prefs.success && prefs.data.inApp?.system === false) continue;
      const key = `wf-${scope.executionId}-${step.id}-${user.id}`;
      const existing = await db.notification.findFirst({
        where: { userId: user.id, data: { path: ['idempotencyKey'], equals: key } },
        select: { id: true },
      });
      if (!existing) {
        await db.notification.create({
          data: {
            organizationId,
            userId: user.id,
            type: 'system',
            title,
            body,
            link,
            data: {
              idempotencyKey: key,
              workflowId: scope.workflowId,
              executionId: scope.executionId,
              stepId: step.id,
            },
          },
        });
      }
      delivered += 1;
      deliveredTo.push(user.id);
    }
    return { delivered, userIds: deliveredTo };
  }

  /** Assignee from the event payload: explicit `assigneeId`, else the lead's / conversation's assignee. */
  private async resolveAssignee(
    organizationId: string,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    const db = this.prisma.client;
    const direct = asString(payload.assigneeId);
    const candidate = direct && UUID_RE.test(direct) ? direct : null;
    let userId = candidate;
    const leadId = asString(payload.leadId);
    const conversationId = asString(payload.conversationId);
    const dealId = asString(payload.dealId);
    const ownerId = asString(payload.ownerId);
    if (!userId && ownerId && UUID_RE.test(ownerId)) userId = ownerId;
    if (!userId && dealId && UUID_RE.test(dealId)) {
      userId =
        (
          await db.deal.findFirst({
            where: { id: dealId, organizationId },
            select: { ownerId: true },
          })
        )?.ownerId ?? null;
    }
    if (!userId && leadId && UUID_RE.test(leadId)) {
      userId =
        (
          await db.lead.findFirst({
            where: { id: leadId, organizationId },
            select: { assigneeId: true },
          })
        )?.assigneeId ?? null;
    }
    if (!userId && conversationId && UUID_RE.test(conversationId)) {
      userId =
        (
          await db.conversation.findFirst({
            where: { id: conversationId, organizationId },
            select: { assigneeId: true },
          })
        )?.assigneeId ?? null;
    }
    if (!userId) return null;
    const member = await db.organizationMember.findFirst({
      where: { organizationId, userId, status: 'active' },
      select: { userId: true },
    });
    return member?.userId ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // http_request
  // -------------------------------------------------------------------------------------------

  private async httpRequest(step: StepOf<'http_request'>, runtime: StepRuntime): Promise<unknown> {
    const url = runtime.render(step.url).trim();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(step.headers)) headers[k.toLowerCase()] = runtime.render(v);
    const hasBody = step.body !== undefined && !['GET', 'DELETE'].includes(step.method);
    const body = hasBody ? runtime.render(step.body!) : undefined;
    if (hasBody && !headers['content-type']) {
      headers['content-type'] = /^\s*[{[]/.test(body ?? '')
        ? 'application/json'
        : 'text/plain; charset=utf-8';
    }
    headers['user-agent'] ??= 'HilaTech-Automation/1.0';
    try {
      const res = await safeRequest(url, {
        ...outboundPolicyFor(this.env),
        method: step.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        timeoutMs: Math.max(1_000, Math.min(step.timeoutMs, runtime.remainingMs || step.timeoutMs)),
        maxResponseBytes: HTTP_BODY_LIMIT,
      });
      return assertSuccess(res);
    } catch (error) {
      if (error instanceof StepError) throw error;
      throw httpFailure(error);
    }
  }

  // -------------------------------------------------------------------------------------------
  // update_lead / create_lead_note
  // -------------------------------------------------------------------------------------------

  private async updateLead(
    scope: ExecutionScope,
    step: StepOf<'update_lead'>,
    runtime: StepRuntime,
  ): Promise<unknown> {
    const { organizationId } = scope;
    const db = this.prisma.client;
    const leadId = runtime.render(step.leadId).trim();
    if (!UUID_RE.test(leadId)) throw new StepError(`Invalid lead id "${truncate(leadId, 60)}"`);
    const lead = await db.lead.findFirst({
      where: { id: leadId, organizationId, deletedAt: null },
    });
    if (!lead) throw new StepError('Lead not found in this organization');

    const data: Prisma.LeadUncheckedUpdateInput = {};
    const activities: Array<{ type: string; payload: Prisma.InputJsonObject }> = [];
    const changed: string[] = [];

    if (step.status && step.status !== lead.status) {
      data.status = step.status;
      changed.push('status');
      activities.push({
        type: 'status_changed',
        payload: { from: lead.status, to: step.status, viaAutomation: true },
      });
    }
    const assignee = step.assigneeId ? runtime.render(step.assigneeId).trim() : '';
    if (assignee && assignee !== lead.assigneeId) {
      if (!UUID_RE.test(assignee)) throw new StepError('Invalid assignee id');
      const member = await db.organizationMember.findFirst({
        where: { organizationId, userId: assignee, status: 'active' },
        select: { id: true },
      });
      if (!member) throw new StepError('Assignee is not an active member of this organization');
      data.assigneeId = assignee;
      changed.push('assigneeId');
      activities.push({
        type: 'assigned',
        payload: { from: lead.assigneeId, to: assignee, viaAutomation: true },
      });
    }
    const newTags = step.addTags
      .map((t) => runtime.render(t).trim())
      .filter((t) => t && !lead.tags.includes(t));
    if (newTags.length > 0) {
      data.tags = [...lead.tags, ...new Set(newTags)];
      changed.push('tags');
      activities.push({
        type: 'updated',
        payload: { fields: ['tags'], addedTags: newTags, viaAutomation: true },
      });
    }

    if (changed.length > 0) {
      const base = Date.now();
      await db.$transaction([
        db.lead.update({ where: { id: lead.id }, data }),
        db.leadActivity.createMany({
          data: activities.map((a, i) => ({
            leadId: lead.id,
            actorId: null,
            type: a.type,
            payload: a.payload,
            createdAt: new Date(base + i),
          })),
        }),
      ]);
      await this.audit(scope, 'update_lead', 'lead', lead.id, { changed, stepId: step.id });
    }
    return { leadId: lead.id, changed };
  }

  private async createLeadNote(
    scope: ExecutionScope,
    step: StepOf<'create_lead_note'>,
    runtime: StepRuntime,
  ): Promise<unknown> {
    const { organizationId } = scope;
    const db = this.prisma.client;
    const leadId = runtime.render(step.leadId).trim();
    if (!UUID_RE.test(leadId)) throw new StepError(`Invalid lead id "${truncate(leadId, 60)}"`);
    const lead = await db.lead.findFirst({
      where: { id: leadId, organizationId, deletedAt: null },
      select: { id: true, assigneeId: true },
    });
    if (!lead) throw new StepError('Lead not found in this organization');
    const body = runtime.render(step.body).trim();
    if (!body) throw new StepError('Note body rendered empty');
    const authorId = await this.resolveNoteAuthor(scope, lead.assigneeId);
    if (!authorId) throw new StepError('No active member available to author the note');

    const note = await db.leadNote.create({
      data: { leadId: lead.id, authorId, body: body.slice(0, 10_000) },
      select: { id: true },
    });
    await db.leadActivity.create({
      data: {
        leadId: lead.id,
        actorId: null,
        type: 'note_added',
        payload: { noteId: note.id, preview: truncate(body, 120), viaAutomation: true },
      },
    });
    await this.audit(scope, 'create_lead_note', 'lead', lead.id, {
      noteId: note.id,
      stepId: step.id,
    });
    return { noteId: note.id, leadId: lead.id };
  }

  // -------------------------------------------------------------------------------------------
  // create_task
  // -------------------------------------------------------------------------------------------

  /**
   * Creates a task (source `automation`). The id is derived from execution + step, so a retried step returns the task
   * it already created instead of duplicating it. Related ids default to the trigger payload and must belong to the
   * organization; the assignee must be an active member (`kind: assignee` = the lead / conversation / deal owner).
   */
  private async createTask(
    scope: ExecutionScope,
    step: StepOf<'create_task'>,
    runtime: StepRuntime,
  ): Promise<unknown> {
    const { organizationId } = scope;
    const db = this.prisma.client;
    const title = truncate(runtime.render(step.title).trim(), 200);
    if (!title) throw new StepError('Task title rendered empty');
    const description = step.description ? runtime.render(step.description).trim() || null : null;
    const payload = payloadOf(runtime);

    const resolveRef = async (
      explicit: string | undefined,
      payloadKey: string,
      lookup: (id: string) => Promise<{ id: string } | null>,
      label: string,
    ): Promise<string | null> => {
      if (explicit !== undefined) {
        const id = runtime.render(explicit).trim();
        if (!id) return null;
        if (!UUID_RE.test(id)) throw new StepError(`Invalid ${label} id "${truncate(id, 60)}"`);
        const found = await lookup(id);
        if (!found) throw new StepError(`${label} not found in this organization`);
        return found.id;
      }
      const fromPayload = asString(payload[payloadKey]);
      if (!fromPayload || !UUID_RE.test(fromPayload)) return null;
      return (await lookup(fromPayload))?.id ?? null;
    };
    const leadId = await resolveRef(
      step.leadId,
      'leadId',
      (id) =>
        db.lead.findFirst({ where: { id, organizationId, deletedAt: null }, select: { id: true } }),
      'Lead',
    );
    const contactId = await resolveRef(
      step.contactId,
      'contactId',
      (id) =>
        db.contact.findFirst({
          where: { id, organizationId, deletedAt: null },
          select: { id: true },
        }),
      'Contact',
    );
    const dealId = await resolveRef(
      step.dealId,
      'dealId',
      (id) => db.deal.findFirst({ where: { id, organizationId }, select: { id: true } }),
      'Deal',
    );
    const conversationId = await resolveRef(
      step.conversationId,
      'conversationId',
      (id) => db.conversation.findFirst({ where: { id, organizationId }, select: { id: true } }),
      'Conversation',
    );

    let assigneeId: string | null = null;
    if (step.assignee?.kind === 'user') {
      const member = await db.organizationMember.findFirst({
        where: { organizationId, userId: step.assignee.userId, status: 'active' },
        select: { userId: true },
      });
      if (!member) throw new StepError('Assignee is not an active member of this organization');
      assigneeId = member.userId;
    } else if (step.assignee?.kind === 'assignee') {
      assigneeId = await this.resolveAssignee(organizationId, {
        ...payload,
        ...(leadId ? { leadId } : {}),
        ...(dealId ? { dealId } : {}),
        ...(conversationId ? { conversationId } : {}),
      });
    }

    const now = new Date();
    const dueAt =
      step.dueInHours !== undefined ? new Date(now.getTime() + step.dueInHours * 3_600_000) : null;
    const reminderAt =
      dueAt && step.reminderBeforeHours !== undefined
        ? new Date(dueAt.getTime() - step.reminderBeforeHours * 3_600_000)
        : null;
    const id = deterministicUuid('task', scope.executionId, step.id);
    // Attributed to the run's human actor, else the workflow creator; never silently to the assignee.
    const createdById = scope.actorUserId ?? scope.createdById ?? null;
    let created = false;
    try {
      await db.task.create({
        data: {
          id,
          organizationId,
          title,
          description,
          priority: step.priority,
          source: 'automation',
          dueAt,
          reminderAt,
          assigneeId,
          createdById,
          leadId,
          contactId,
          dealId,
          conversationId,
        },
      });
      created = true;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    if (created) {
      await this.audit(scope, 'create_task', 'task', id, { stepId: step.id, assigneeId });
      if (assigneeId && assigneeId !== createdById) {
        await db.notification
          .create({
            data: {
              organizationId,
              userId: assigneeId,
              type: 'task_assigned',
              title: truncate(title, 200),
              link: '/tasks',
              data: { idempotencyKey: `task-assigned:${id}`, taskId: id },
            },
          })
          .catch((err: unknown) =>
            this.logger.warn({ err, taskId: id }, 'Could not notify the task assignee'),
          );
      }
    }
    return { taskId: id, created, assigneeId, dueAt: dueAt?.toISOString() ?? null };
  }

  /** Notes need a human author: the run's actor, the workflow creator, the lead assignee, else the oldest owner. */
  private async resolveNoteAuthor(
    scope: ExecutionScope,
    assigneeId: string | null,
  ): Promise<string | null> {
    const db = this.prisma.client;
    for (const candidate of [scope.actorUserId, scope.createdById, assigneeId]) {
      if (!candidate) continue;
      const m = await db.organizationMember.findFirst({
        where: { organizationId: scope.organizationId, userId: candidate, status: 'active' },
        select: { userId: true },
      });
      if (m) return m.userId;
    }
    const owner = await db.organizationMember.findFirst({
      where: { organizationId: scope.organizationId, status: 'active', role: { key: 'owner' } },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }

  private async audit(
    scope: ExecutionScope,
    action: string,
    targetType: string,
    targetId: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: AuditAction.WORKFLOW_ACTION,
          organizationId: scope.organizationId,
          actorUserId: null,
          targetType,
          targetId,
          metadata: {
            automation: true,
            step: action,
            workflowId: scope.workflowId,
            workflowName: scope.workflowName,
            executionId: scope.executionId,
            ...extra,
          } as Prisma.InputJsonObject,
        },
      });
    } catch (err) {
      this.logger.error({ err, action }, 'Failed to write automation audit log');
    }
  }

  // -------------------------------------------------------------------------------------------
  // n8n_trigger
  // -------------------------------------------------------------------------------------------

  private async n8nTrigger(
    scope: ExecutionScope,
    step: StepOf<'n8n_trigger'>,
    runtime: StepRuntime,
  ): Promise<unknown> {
    const integration = await this.prisma.client.integration.findFirst({
      where: { organizationId: scope.organizationId, kind: 'n8n', isEnabled: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!integration) throw new StepError('No enabled n8n integration is connected');
    const config = integrationConfigSchema.safeParse(integration.config);
    if (!config.success || config.data.kind !== 'n8n')
      throw new StepError('The n8n integration configuration is invalid');
    const secrets = this.decryptSecrets(scope.organizationId, integration.encryptedSecrets);

    const target = runtime.render(step.webhook).trim();
    if (!target) throw new StepError('n8n webhook path rendered empty');
    const prefix = config.data.webhookPathPrefix || '/webhook';
    const url = /^https?:\/\//i.test(target)
      ? target
      : joinUrl(config.data.baseUrl, `${prefix.replace(/\/+$/, '')}/${target.replace(/^\/+/, '')}`);

    // The n8n API key is only ever sent to the configured n8n origin.
    let sameOrigin = false;
    try {
      sameOrigin = new URL(url).origin === new URL(config.data.baseUrl).origin;
    } catch {
      /* invalid URL is reported by the guard below */
    }
    const payload = {
      ...(renderDeep(step.payload, runtime.context) as Record<string, unknown>),
      _hilatech: {
        organizationId: scope.organizationId,
        workflowId: scope.workflowId,
        executionId: scope.executionId,
        trigger: (runtime.context.trigger as Record<string, unknown>).type ?? null,
      },
    };
    try {
      const res = await safeRequest(url, {
        ...outboundPolicyFor(this.env),
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'HilaTech-Automation/1.0',
          ...(sameOrigin ? buildN8nHeaders(secrets) : {}),
        },
        body: JSON.stringify(payload),
        timeoutMs: Math.max(1_000, Math.min(30_000, runtime.remainingMs || 30_000)),
        maxResponseBytes: HTTP_BODY_LIMIT,
      });
      return assertSuccess(res);
    } catch (error) {
      if (error instanceof StepError) throw error;
      throw httpFailure(error);
    }
  }

  private decryptSecrets(organizationId: string, envelope: string | null): IntegrationSecrets {
    if (!envelope) return {};
    if (!this.box)
      throw new StepError('CREDENTIALS_ENCRYPTION_KEY is not configured for the workers');
    try {
      const parsed = integrationSecretsSchema.safeParse(
        JSON.parse(this.box.decrypt(envelope, organizationId)),
      );
      return parsed.success ? parsed.data : {};
    } catch {
      throw new StepError('Integration credentials could not be decrypted');
    }
  }

  // -------------------------------------------------------------------------------------------
  // outbound_webhook
  // -------------------------------------------------------------------------------------------

  private async outboundWebhook(
    scope: ExecutionScope,
    step: StepOf<'outbound_webhook'>,
    runtime: StepRuntime,
  ): Promise<unknown> {
    const webhooks = await this.prisma.client.webhook.findMany({
      where: { organizationId: scope.organizationId, isEnabled: true, events: { has: step.event } },
      select: { id: true },
    });
    const payload = renderDeep(step.payload, runtime.context) as Prisma.InputJsonObject;
    let created = 0;
    for (const webhook of webhooks) {
      const id = deterministicUuid('wf-step-delivery', scope.executionId, step.id, webhook.id);
      const exists = await this.prisma.client.webhookDelivery.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) {
        await this.prisma.client.webhookDelivery.create({
          data: {
            id,
            organizationId: scope.organizationId,
            webhookId: webhook.id,
            event: step.event,
            payload: {
              ...payload,
              _workflow: { workflowId: scope.workflowId, executionId: scope.executionId },
            },
            status: 'pending',
            nextAttemptAt: new Date(),
          },
        });
      }
      await this.producer.enqueue(QueueName.WEBHOOK_DELIVERY, {
        organizationId: scope.organizationId,
        deliveryId: id,
        attempt: 0,
        idempotencyKey: `whd-${id}-0`,
        enqueuedAt: new Date().toISOString(),
      });
      created += 1;
    }
    return { deliveries: created };
  }

  // -------------------------------------------------------------------------------------------
  // agent_run
  // -------------------------------------------------------------------------------------------

  private async agentRun(
    scope: ExecutionScope,
    step: StepOf<'agent_run'>,
    runtime: StepRuntime,
  ): Promise<unknown> {
    const { organizationId } = scope;
    const db = this.prisma.client;
    const agentRow = await db.agent.findFirst({ where: { id: step.agentId, organizationId } });
    if (!agentRow) throw new StepError('Agent not found in this organization');
    if (!agentRow.isEnabled) throw new StepError('Agent is disabled');
    const input = runtime.render(step.input);

    const executionId = deterministicUuid('wf-step-agent', scope.executionId, step.id);
    const existing = await db.agentExecution.findFirst({
      where: { id: executionId, organizationId },
    });
    if (existing && (existing.status === 'succeeded' || existing.status === 'failed')) {
      return this.agentOutput(existing.id, existing.status, existing.output, existing.error);
    }
    if (!existing) {
      await db.agentExecution.create({
        data: {
          id: executionId,
          organizationId,
          agentId: agentRow.id,
          trigger: 'automation',
          status: 'queued',
          input,
          triggeredByUserId: null,
          depth: 0,
          rootExecutionId: executionId,
        },
      });
    }

    if (!step.wait) {
      await this.producer.enqueue(QueueName.AI_TASKS, {
        organizationId,
        kind: 'agent_execution',
        targetId: executionId,
        requestedByUserId: null,
        idempotencyKey: `agent-exec-${executionId}`,
        enqueuedAt: new Date().toISOString(),
      });
      return { executionId, status: 'queued', output: null, error: null };
    }

    const budget = await this.runtime.checkBudget(organizationId);
    if (budget.blocked) {
      await this.runtime.store.finish(executionId, {
        status: 'failed',
        output: null,
        error: budget.message,
        stepCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: null,
        finishedAt: new Date(),
        durationMs: 0,
      });
      throw new StepError(`Agent run failed: ${budget.message}`, {
        output: this.agentOutput(executionId, 'failed', null, budget.message),
      });
    }

    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    const result = await this.runtime.runner.run({
      executionId,
      agent: toAgentDefinition(agentRow),
      input,
      userId: null,
      userPermissions: null,
      trigger: 'automation',
      depth: 0,
      rootExecutionId: executionId,
      ancestry: [],
      ...(org ? { organizationName: org.name } : {}),
      caps: { maxDurationMs: Math.max(5_000, runtime.remainingMs) },
    });
    const out = this.agentOutput(executionId, result.status, result.output, result.error);
    if (result.status !== 'succeeded') {
      throw new StepError(`Agent run ${result.status}${result.error ? `: ${result.error}` : ''}`, {
        output: out,
      });
    }
    return out;
  }

  private agentOutput(
    executionId: string,
    status: string,
    output: unknown,
    error: string | null,
  ): Record<string, unknown> {
    return {
      executionId,
      status,
      output: typeof output === 'string' ? output : (output ?? null),
      error,
    };
  }
}
