import {
  type AssignConversationRequest,
  AuditAction,
  type ConversationWithRelations,
  type CreateConversationRequest,
  type CreateMessageRequest,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MessageWithAuthor,
  QueueName,
  type UpdateConversationRequest,
} from '@hilatech/contracts';
import { type Conversation, Prisma } from '@hilatech/database';
import { truncate } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable, Optional } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { CrmReferencesService } from '../crm/crm-references.service';
import { DomainEventsService } from '../events/domain-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConversationRules } from './conversation.rules';
import {
  CONVERSATION_INCLUDE,
  MESSAGE_INCLUDE,
  toConversationWithRelations,
  toMessage,
  type LastMessageRow,
} from './conversations.mappers';

/** Debounce window before the workers summarise a conversation after new messages. */
export const CONVERSATION_SUMMARY_DELAY_MS = 30_000;

export const conversationSummaryJobId = (conversationId: string, messageCount: number): string =>
  `conv-summary-${conversationId}-${messageCount}`;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refs: CrmReferencesService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
    private readonly logger: Logger,
    @Optional() private readonly events?: DomainEventsService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------------------------

  async list(
    tenant: TenantContext,
    query: ListConversationsQuery,
  ): Promise<PageResult<ConversationWithRelations>> {
    const where: Prisma.ConversationWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.search ? { OR: searchClauses(query.search) } : {}),
    };
    const [baseRows, total] = await this.prisma.client.$transaction([
      this.prisma.client.conversation.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: orderBy(query),
        ...skipTake(query),
      }),
      this.prisma.client.conversation.count({ where }),
    ]);
    const rows = await this.withLastMessage(baseRows);
    return page(rows.map(toConversationWithRelations), query, total);
  }

  async create(
    tenant: TenantContext,
    dto: CreateConversationRequest,
    meta: RequestMeta,
  ): Promise<ConversationWithRelations> {
    if (dto.contactId) await this.refs.assertContact(tenant, dto.contactId, 'contactId');
    if (dto.leadId) await this.refs.assertLead(tenant, dto.leadId, 'leadId');
    if (dto.assigneeId) {
      await this.refs.assertActiveMember(tenant, dto.assigneeId, 'assigneeId');
      ConversationRules.assertCanSetAssignee(tenant, dto.assigneeId, null);
    }

    const createdRow = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          organizationId: tenant.organizationId,
          subject: dto.subject ?? null,
          channel: dto.channel,
          contactId: dto.contactId ?? null,
          leadId: dto.leadId ?? null,
          assigneeId: dto.assigneeId ?? null,
        },
      });
      if (dto.initialMessage) {
        // The opening message is written by the caller, so it is an `agent` message authored by them.
        const message = await tx.message.create({
          data: {
            conversationId: created.id,
            role: 'agent',
            authorUserId: tenant.userId,
            content: dto.initialMessage,
          },
        });
        await tx.conversation.update({
          where: { id: created.id },
          data: { lastMessageAt: message.createdAt, messageCount: 1 },
        });
      }
      return tx.conversation.findUniqueOrThrow({
        where: { id: created.id },
        include: CONVERSATION_INCLUDE,
      });
    });
    const [conversation] = await this.withLastMessage([createdRow]);
    if (!conversation) throw AppException.notFound('Conversation');

    await this.audit.log({
      action: AuditAction.CONVERSATION_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'conversation',
      targetId: conversation.id,
      metadata: {
        channel: conversation.channel,
        contactId: conversation.contactId,
        leadId: conversation.leadId,
        withInitialMessage: Boolean(dto.initialMessage),
      },
      request: meta,
    });
    if (conversation.assigneeId) {
      await this.notifyAssigned(tenant, conversation, conversation.assigneeId, meta);
    }
    await this.emitEvent(
      tenant,
      meta,
      'conversation.created',
      conversationEventPayload(conversation),
    );
    return toConversationWithRelations(conversation);
  }

  async get(tenant: TenantContext, id: string): Promise<ConversationWithRelations> {
    return toConversationWithRelations(await this.requireConversationWithLast(tenant, id));
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateConversationRequest,
    meta: RequestMeta,
  ): Promise<ConversationWithRelations> {
    const existing = await this.requireConversationWithLast(tenant, id);
    if (dto.contactId) await this.refs.assertContact(tenant, dto.contactId, 'contactId');
    if (dto.leadId) await this.refs.assertLead(tenant, dto.leadId, 'leadId');
    if (dto.assigneeId !== undefined && dto.assigneeId !== existing.assigneeId) {
      if (dto.assigneeId) await this.refs.assertActiveMember(tenant, dto.assigneeId, 'assigneeId');
      ConversationRules.assertCanSetAssignee(tenant, dto.assigneeId, existing.assigneeId);
    }

    const data: Prisma.ConversationUncheckedUpdateInput = {};
    if (dto.subject !== undefined && dto.subject !== existing.subject) data.subject = dto.subject;
    if (dto.status !== undefined && dto.status !== existing.status) data.status = dto.status;
    if (dto.assigneeId !== undefined && dto.assigneeId !== existing.assigneeId) {
      data.assigneeId = dto.assigneeId;
    }
    if (dto.contactId !== undefined && dto.contactId !== existing.contactId) {
      data.contactId = dto.contactId;
    }
    if (dto.leadId !== undefined && dto.leadId !== existing.leadId) data.leadId = dto.leadId;
    if (Object.keys(data).length === 0) return toConversationWithRelations(existing);

    const updated = await this.withLastMessageOne(
      await this.prisma.client.conversation.update({
        where: { id: existing.id },
        data,
        include: CONVERSATION_INCLUDE,
      }),
    );
    await this.audit.log({
      action: AuditAction.CONVERSATION_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'conversation',
      targetId: existing.id,
      metadata: {
        kind: 'update',
        changes: Object.keys(data),
        ...(data.status ? { from: existing.status, to: data.status } : {}),
      },
      request: meta,
    });
    if (data.assigneeId && typeof data.assigneeId === 'string') {
      await this.notifyAssigned(tenant, updated, data.assigneeId, meta);
    }
    if (data.assigneeId !== undefined) {
      await this.emitEvent(tenant, meta, 'conversation.assigned', {
        ...conversationEventPayload(updated),
        previousAssigneeId: existing.assigneeId,
      });
    }
    if (data.status === 'resolved') {
      await this.emitEvent(tenant, meta, 'conversation.resolved', {
        ...conversationEventPayload(updated),
        previousStatus: existing.status,
      });
    }
    return toConversationWithRelations(updated);
  }

  async assign(
    tenant: TenantContext,
    id: string,
    dto: AssignConversationRequest,
    meta: RequestMeta,
  ): Promise<ConversationWithRelations> {
    const existing = await this.requireConversationWithLast(tenant, id);
    if (dto.assigneeId) await this.refs.assertActiveMember(tenant, dto.assigneeId, 'assigneeId');
    if (dto.assigneeId === existing.assigneeId) return toConversationWithRelations(existing);

    const updated = await this.withLastMessageOne(
      await this.prisma.client.conversation.update({
        where: { id: existing.id },
        data: { assigneeId: dto.assigneeId },
        include: CONVERSATION_INCLUDE,
      }),
    );
    await this.audit.log({
      action: AuditAction.CONVERSATION_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'conversation',
      targetId: existing.id,
      metadata: { kind: 'assign', from: existing.assigneeId, to: dto.assigneeId },
      request: meta,
    });
    if (dto.assigneeId) await this.notifyAssigned(tenant, updated, dto.assigneeId, meta);
    await this.emitEvent(tenant, meta, 'conversation.assigned', {
      ...conversationEventPayload(updated),
      previousAssigneeId: existing.assigneeId,
    });
    return toConversationWithRelations(updated);
  }

  // ---------------------------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------------------------

  async listMessages(
    tenant: TenantContext,
    conversationId: string,
    query: ListMessagesQuery,
  ): Promise<PageResult<MessageWithAuthor>> {
    const conversation = await this.requireConversation(tenant, conversationId);
    const where = { conversationId: conversation.id };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.message.findMany({
        where,
        include: MESSAGE_INCLUDE,
        orderBy: { createdAt: query.sortOrder },
        ...skipTake(query),
      }),
      this.prisma.client.message.count({ where }),
    ]);
    return page(rows.map(toMessage), query, total);
  }

  /**
   * Appends a message and updates the conversation counters in the same transaction. Archived
   * conversations reject new messages (409); a resolved conversation is reopened.
   */
  async postMessage(
    tenant: TenantContext,
    conversationId: string,
    dto: CreateMessageRequest,
    meta: RequestMeta,
  ): Promise<MessageWithAuthor> {
    ConversationRules.assertApiRole(dto.role);
    const conversation = await this.requireConversation(tenant, conversationId);
    ConversationRules.assertPostable(conversation);
    const nextStatus = ConversationRules.statusAfterMessage(conversation.status);

    const message = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: conversation.id,
          role: dto.role,
          authorUserId: ConversationRules.authorFor(dto.role, tenant),
          content: dto.content,
          metadata: dto.metadata as Prisma.InputJsonObject,
        },
        include: MESSAGE_INCLUDE,
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: created.createdAt,
          messageCount: { increment: 1 },
          ...(nextStatus !== conversation.status ? { status: nextStatus } : {}),
        },
      });
      return created;
    });

    if (nextStatus !== conversation.status) {
      await this.audit.log({
        action: AuditAction.CONVERSATION_UPDATED,
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        targetType: 'conversation',
        targetId: conversation.id,
        metadata: { kind: 'reopened', from: conversation.status, to: nextStatus },
        request: meta,
      });
    }
    await this.scheduleSummary(tenant, conversation.id, conversation.messageCount + 1, meta);
    if (dto.role === 'customer') {
      await this.emitEvent(tenant, meta, 'conversation.message_received', {
        conversationId: conversation.id,
        messageId: message.id,
        role: dto.role,
        channel: conversation.channel,
        assigneeId: conversation.assigneeId,
        contactId: conversation.contactId,
        leadId: conversation.leadId,
        preview: truncate(dto.content, 500),
      });
    }
    return toMessage(message);
  }

  /**
   * Asks the workers to refresh the AI summary of a conversation (job kind `conversation_summary` on
   * `ai-tasks`, delayed 30s so bursts of messages collapse). Only when the organization has an enabled
   * AI provider; never fails the caller's request.
   */
  private async scheduleSummary(
    tenant: TenantContext,
    conversationId: string,
    messageCount: number,
    meta: RequestMeta,
  ): Promise<void> {
    try {
      const providers = await this.prisma.client.aiProviderConfig.count({
        where: { organizationId: tenant.organizationId, isEnabled: true },
      });
      if (!(providers > 0)) return;
      await this.queue.enqueue(
        QueueName.AI_TASKS,
        {
          organizationId: tenant.organizationId,
          kind: 'conversation_summary',
          targetId: conversationId,
          requestedByUserId: tenant.userId,
          idempotencyKey: conversationSummaryJobId(conversationId, messageCount),
          requestId: meta.requestId ?? undefined,
          enqueuedAt: new Date().toISOString(),
        },
        { delay: CONVERSATION_SUMMARY_DELAY_MS },
      );
    } catch (error) {
      this.logger.warn(
        { err: error, conversationId },
        'Could not schedule conversation summary',
        ConversationsService.name,
      );
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private async emitEvent(
    tenant: TenantContext,
    meta: RequestMeta,
    event:
      | 'conversation.created'
      | 'conversation.message_received'
      | 'conversation.assigned'
      | 'conversation.resolved',
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events?.emit(tenant.organizationId, event, payload, {
      actorUserId: tenant.userId,
      requestId: meta.requestId,
    });
  }

  private async requireConversation(tenant: TenantContext, id: string) {
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw AppException.notFound('Conversation');
    return conversation;
  }

  /** `requireConversation` plus the latest message (only needed when the row is returned to the client). */
  private async requireConversationWithLast(tenant: TenantContext, id: string) {
    return this.withLastMessageOne(await this.requireConversation(tenant, id));
  }

  private async withLastMessageOne<T extends { id: string }>(row: T) {
    const [withLast] = await this.withLastMessage([row]);
    return withLast as T & { messages: LastMessageRow[] };
  }

  /**
   * Attaches `messages: [latest]` to each row with ONE indexed lookup per conversation
   * (`Message(conversationId, createdAt)`), independent of how many messages a conversation has.
   */
  private async withLastMessage<T extends { id: string }>(
    rows: T[],
  ): Promise<Array<T & { messages: LastMessageRow[] }>> {
    if (rows.length === 0) return [];
    const ids = Prisma.join(rows.map((r) => Prisma.sql`(${r.id}::uuid)`));
    const latest = await this.prisma.client.$queryRaw<
      Array<{ conversationId: string; role: LastMessageRow['role']; content: string }>
    >`
      SELECT m."conversationId", m."role"::text AS role, m."content"
      FROM (VALUES ${ids}) AS c(id)
      CROSS JOIN LATERAL (
        SELECT "conversationId", "role", "content" FROM "Message"
        WHERE "conversationId" = c.id ORDER BY "createdAt" DESC LIMIT 1
      ) m`;
    const byConversation = new Map(latest.map((l) => [l.conversationId, l]));
    return rows.map((row) => {
      const l = byConversation.get(row.id);
      return { ...row, messages: l ? [{ role: l.role, content: l.content }] : [] };
    });
  }

  private async notifyAssigned(
    tenant: TenantContext,
    conversation: Pick<Conversation, 'id' | 'subject'>,
    assigneeId: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (assigneeId === tenant.userId) return;
    const actor = await this.prisma.client.user.findUnique({
      where: { id: tenant.userId },
      select: { firstName: true, lastName: true },
    });
    const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : 'A teammate';
    const subject = conversation.subject ?? 'a conversation';
    await this.notifications.notify({
      organizationId: tenant.organizationId,
      userId: assigneeId,
      type: 'conversation_assigned',
      title: truncate(`Conversation assigned to you: ${subject}`, 200),
      body: `${actorName} assigned you ${conversation.subject ? `"${conversation.subject}"` : subject}.`,
      link: `/conversations/${conversation.id}`,
      data: { conversationId: conversation.id, assignedBy: tenant.userId },
      requestId: meta.requestId,
    });
  }
}

// -----------------------------------------------------------------------------------------------
// Helpers (pure)
// -----------------------------------------------------------------------------------------------

/** Case-insensitive search over subject and the linked contact's name. */
export function searchClauses(search: string): Prisma.ConversationWhereInput[] {
  const contains = { contains: search, mode: 'insensitive' as const };
  return [
    { subject: contains },
    { contact: { firstName: contains } },
    { contact: { lastName: contains } },
  ];
}

function orderBy(query: ListConversationsQuery): Prisma.ConversationOrderByWithRelationInput {
  if (query.sortBy === 'lastMessageAt') {
    return { lastMessageAt: { sort: query.sortOrder, nulls: 'last' } };
  }
  return { [query.sortBy]: query.sortOrder };
}

/** Domain-event payload for a conversation (ids and scalar facts only). */
export function conversationEventPayload(
  c: Pick<
    Conversation,
    'id' | 'channel' | 'status' | 'subject' | 'assigneeId' | 'contactId' | 'leadId'
  >,
): Record<string, unknown> {
  return {
    conversationId: c.id,
    channel: c.channel,
    status: c.status,
    subject: c.subject,
    assigneeId: c.assigneeId,
    contactId: c.contactId,
    leadId: c.leadId,
  };
}
