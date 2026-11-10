import { ALL_PERMISSIONS, ErrorCode, QueueName } from '@hilatech/contracts';
import { type Logger } from 'nestjs-pino';

import { type QueueService } from '../../infrastructure/queue/queue.service';
import { createAuditMock, createLoggerMock, createPrismaMock } from '../../test-utils/prisma.mock';
import { type AuditService } from '../audit/audit.service';
import { type CrmReferencesService } from '../crm/crm-references.service';
import { type NotificationsService } from '../notifications/notifications.service';
import { CONVERSATION_SUMMARY_DELAY_MS, ConversationsService } from './conversations.service';

const ORG = '22222222-2222-4222-8222-222222222222';
const tenant = {
  organizationId: ORG,
  userId: 'u1',
  memberId: 'm1',
  roleId: 'r1',
  roleKey: 'owner',
  permissions: ALL_PERMISSIONS,
};
const meta = { ipAddress: null, userAgent: null, requestId: null };
const now = new Date('2026-11-01T10:00:00Z');

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cv1',
    organizationId: ORG,
    subject: 'Pricing question',
    status: 'open' as const,
    channel: 'web' as const,
    contactId: null,
    leadId: null,
    assigneeId: null,
    summary: null,
    lastMessageAt: null,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
    contact: null,
    lead: null,
    assignee: null,
    messages: [],
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    conversationId: 'cv1',
    role: 'agent' as const,
    authorUserId: 'u1',
    content: 'Hello',
    metadata: {},
    createdAt: now,
    author: { id: 'u1', email: 'a@b.c', firstName: 'A', lastName: 'B', avatarUrl: null },
    ...overrides,
  };
}

describe('ConversationsService.postMessage', () => {
  function build() {
    const { service: prisma, client } = createPrismaMock();
    const audit = createAuditMock();
    const refs = {
      assertActiveMember: jest.fn(),
      assertContact: jest.fn(),
      assertLead: jest.fn(),
    };
    const notifications = { notify: jest.fn().mockResolvedValue(null) };
    const queue = {
      enqueue: jest.fn().mockResolvedValue({ jobId: 'j', queue: QueueName.AI_TASKS }),
    };
    const service = new ConversationsService(
      prisma,
      audit as unknown as AuditService,
      refs as unknown as CrmReferencesService,
      notifications as unknown as NotificationsService,
      queue as unknown as QueueService,
      createLoggerMock() as unknown as Logger,
    );
    return { service, client, audit, notifications, queue };
  }

  it('rejects the assistant role before any database access', async () => {
    const { service, client } = build();
    await expect(
      service.postMessage(tenant, 'cv1', { role: 'assistant', content: 'hi', metadata: {} }, meta),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    expect(client.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('answers 404 for a conversation outside the tenant', async () => {
    const { service, client } = build();
    client.conversation.findFirst.mockResolvedValue(null);
    await expect(
      service.postMessage(tenant, 'cv1', { role: 'agent', content: 'hi', metadata: {} }, meta),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(client.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cv1', organizationId: ORG } }),
    );
  });

  it('refuses archived conversations with 409 and writes nothing', async () => {
    const { service, client } = build();
    client.conversation.findFirst.mockResolvedValue(conversationRow({ status: 'archived' }));
    await expect(
      service.postMessage(tenant, 'cv1', { role: 'agent', content: 'hi', metadata: {} }, meta),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(client.message.create).not.toHaveBeenCalled();
    expect(client.conversation.update).not.toHaveBeenCalled();
  });

  it('creates the message and bumps counters in one transaction; agent messages are authored by the caller', async () => {
    const { service, client } = build();
    client.conversation.findFirst.mockResolvedValue(conversationRow());
    client.message.create.mockResolvedValue(messageRow());

    const result = await service.postMessage(
      tenant,
      'cv1',
      { role: 'agent', content: 'Hello', metadata: {} },
      meta,
    );

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'agent', authorUserId: 'u1', content: 'Hello' }),
      }),
    );
    expect(client.conversation.update).toHaveBeenCalledWith({
      where: { id: 'cv1' },
      data: { lastMessageAt: now, messageCount: { increment: 1 } },
    });
    expect(result.author?.id).toBe('u1');
  });

  it('customer messages carry no author and a resolved conversation is reopened (audited)', async () => {
    const { service, client, audit } = build();
    client.conversation.findFirst.mockResolvedValue(conversationRow({ status: 'resolved' }));
    client.message.create.mockResolvedValue(
      messageRow({ role: 'customer', authorUserId: null, author: null }),
    );

    await service.postMessage(
      tenant,
      'cv1',
      { role: 'customer', content: 'Still interested', metadata: { via: 'phone' } },
      meta,
    );

    expect(client.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'customer', authorUserId: null }),
      }),
    );
    expect(client.conversation.update).toHaveBeenCalledWith({
      where: { id: 'cv1' },
      data: { lastMessageAt: now, messageCount: { increment: 1 }, status: 'open' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'conversation.updated',
        metadata: { kind: 'reopened', from: 'resolved', to: 'open' },
      }),
    );
  });

  it('schedules a delayed conversation_summary job only when the organization has an enabled AI provider', async () => {
    const { service, client, queue } = build();
    client.conversation.findFirst.mockResolvedValue(conversationRow({ messageCount: 4 }));
    client.message.create.mockResolvedValue(messageRow());

    client.aiProviderConfig.count.mockResolvedValue(0);
    await service.postMessage(tenant, 'cv1', { role: 'agent', content: 'a', metadata: {} }, meta);
    expect(queue.enqueue).not.toHaveBeenCalled();

    client.aiProviderConfig.count.mockResolvedValue(1);
    await service.postMessage(tenant, 'cv1', { role: 'agent', content: 'b', metadata: {} }, meta);
    expect(queue.enqueue).toHaveBeenCalledWith(
      QueueName.AI_TASKS,
      expect.objectContaining({
        organizationId: ORG,
        kind: 'conversation_summary',
        targetId: 'cv1',
        requestedByUserId: 'u1',
        idempotencyKey: 'conv-summary-cv1-5',
      }),
      { delay: CONVERSATION_SUMMARY_DELAY_MS },
    );

    // A queue failure must never fail the message post.
    queue.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      service.postMessage(tenant, 'cv1', { role: 'agent', content: 'c', metadata: {} }, meta),
    ).resolves.toBeDefined();
  });

  it('assigning to another member notifies them; self-assignment does not', async () => {
    const { service, client, notifications } = build();
    // the latest message is attached with one raw LATERAL lookup (covered by the integration tests)
    (
      service as unknown as { withLastMessage: (rows: object[]) => Promise<object[]> }
    ).withLastMessage = async (rows) => rows.map((r) => ({ ...r, messages: [] }));
    client.conversation.findFirst.mockResolvedValue(conversationRow());
    client.conversation.update.mockResolvedValue(conversationRow({ assigneeId: 'u2' }));
    client.user.findUnique.mockResolvedValue({ firstName: 'Owen', lastName: 'Owner' });
    await service.assign(tenant, 'cv1', { assigneeId: 'u2' }, meta);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        type: 'conversation_assigned',
        link: '/conversations/cv1',
      }),
    );

    notifications.notify.mockClear();
    client.conversation.update.mockResolvedValue(conversationRow({ assigneeId: 'u1' }));
    await service.assign(tenant, 'cv1', { assigneeId: 'u1' }, meta);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
