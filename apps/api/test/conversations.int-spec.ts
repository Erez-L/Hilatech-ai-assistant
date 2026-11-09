import {
  AuditAction,
  type Contact,
  type ConversationWithRelations,
  ErrorCode,
  type LeadWithRelations,
  type MessageWithAuthor,
  type Role,
} from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  expectNoSensitiveLeak,
  register,
  resetDatabase,
} from './setup/test-app';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Conversations', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let outsider: Actor;
  let orgId: string;
  let contact: Contact;
  let lead: LeadWithRelations;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    outsider = await register(ctx, { firstName: 'Out', lastName: 'Sider' });
    orgId = (await createOrganization(ctx, owner, 'Chat Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
    contact = (
      await as(ctx, owner, orgId)
        .post('/api/v1/contacts')
        .send({ firstName: 'Carla', lastName: 'Customer' })
    ).body.data;
    lead = (
      await as(ctx, owner, orgId)
        .post('/api/v1/leads')
        .send({ title: 'Support plan', contactId: contact.id })
    ).body.data;
  });

  afterAll(async () => {
    await ctx.close();
  });

  let conversation: ConversationWithRelations;

  it('creates a conversation with an initial agent message authored by the caller', async () => {
    const res = await as(ctx, member, orgId).post('/api/v1/conversations').send({
      subject: 'Onboarding call',
      channel: 'phone',
      contactId: contact.id,
      leadId: lead.id,
      initialMessage: 'Scheduled the kickoff for Monday.',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      organizationId: orgId,
      subject: 'Onboarding call',
      status: 'open',
      channel: 'phone',
      contact: { id: contact.id, firstName: 'Carla' },
      lead: { id: lead.id, title: 'Support plan', status: 'new' },
      assignee: null,
      messageCount: 1,
      lastMessage: { role: 'agent', content: 'Scheduled the kickoff for Monday.' },
    });
    expect(res.body.data.lastMessageAt).toEqual(expect.any(String));
    expectNoSensitiveLeak(res.body);
    conversation = res.body.data;

    const messages = await as(ctx, member, orgId).get(
      `/api/v1/conversations/${conversation.id}/messages`,
    );
    expect(messages.body.data).toHaveLength(1);
    expect(messages.body.data[0]).toMatchObject({
      role: 'agent',
      authorUserId: member.user.id,
      author: { id: member.user.id, firstName: 'Mia' },
    });
    expect(
      await ctx.prisma.client.auditLog.count({
        where: {
          organizationId: orgId,
          action: AuditAction.CONVERSATION_CREATED,
          targetId: conversation.id,
        },
      }),
    ).toBe(1);
  });

  it('validates referenced ids and the assignee permission on create', async () => {
    const badContact = await as(ctx, owner, orgId)
      .post('/api/v1/conversations')
      .send({ contactId: UNKNOWN_ID });
    expect(badContact.status).toBe(400);
    expect(badContact.body.error.details[0].path).toBe('contactId');
    const badLead = await as(ctx, owner, orgId)
      .post('/api/v1/conversations')
      .send({ leadId: UNKNOWN_ID });
    expect(badLead.body.error.details[0].path).toBe('leadId');
    const badAssignee = await as(ctx, owner, orgId)
      .post('/api/v1/conversations')
      .send({ assigneeId: outsider.user.id });
    expect(badAssignee.body.error.details[0].path).toBe('assigneeId');
    const memberAssignsOther = await as(ctx, member, orgId)
      .post('/api/v1/conversations')
      .send({ assigneeId: owner.user.id });
    expect(memberAssignsOther.status).toBe(403);
    const minimal = await as(ctx, member, orgId).post('/api/v1/conversations').send({});
    expect(minimal.status).toBe(201);
    expect(minimal.body.data).toMatchObject({
      channel: 'internal',
      subject: null,
      messageCount: 0,
      lastMessage: null,
      lastMessageAt: null,
    });
  });

  it('lists with filters, search over subject / contact name and last-message ordering', async () => {
    const all = await as(ctx, member, orgId).get('/api/v1/conversations');
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);
    // default sort: lastMessageAt desc with nulls last
    expect(all.body.data[0].id).toBe(conversation.id);
    const ids = (q: string) =>
      as(ctx, member, orgId)
        .get(`/api/v1/conversations?${q}`)
        .then((r) => r.body.data.map((c: ConversationWithRelations) => c.id));
    expect(await ids('channel=phone')).toEqual([conversation.id]);
    expect(await ids(`contactId=${contact.id}`)).toEqual([conversation.id]);
    expect(await ids('search=onboarding')).toEqual([conversation.id]);
    expect(await ids('search=carla')).toEqual([conversation.id]);
    expect(await ids('status=resolved')).toEqual([]);
  });

  describe('messages', () => {
    it('posts agent / customer / system messages, bumps counters atomically and rejects assistant', async () => {
      const customer = await as(ctx, member, orgId)
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .send({
          role: 'customer',
          content: 'Can we move it to Tuesday?',
          metadata: { via: 'sms' },
        });
      expect(customer.status).toBe(201);
      expect(customer.body.data).toMatchObject({
        conversationId: conversation.id,
        role: 'customer',
        authorUserId: null,
        author: null,
        metadata: { via: 'sms' },
      });
      const agent = await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .send({ content: 'Sure, Tuesday works.' });
      expect(agent.status).toBe(201);
      expect(agent.body.data).toMatchObject({ role: 'agent', authorUserId: owner.user.id });
      const system = await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .send({ role: 'system', content: 'Meeting rescheduled.' });
      expect(system.status).toBe(201);

      const assistant = await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .send({ role: 'assistant', content: 'I am an AI' });
      expect(assistant.status).toBe(400);
      expect(assistant.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(assistant.body.error.details[0].path).toBe('role');

      const detail = await as(ctx, member, orgId).get(`/api/v1/conversations/${conversation.id}`);
      expect(detail.body.data.messageCount).toBe(4);
      expect(detail.body.data.lastMessage).toEqual({
        role: 'system',
        content: 'Meeting rescheduled.',
      });
      expect(detail.body.data.lastMessageAt).toBe(system.body.data.createdAt);
      const row = await ctx.prisma.client.conversation.findUnique({
        where: { id: conversation.id },
      });
      expect(row?.messageCount).toBe(4);
      expect(
        await ctx.prisma.client.message.count({ where: { conversationId: conversation.id } }),
      ).toBe(4);
    });

    it('lists messages oldest first by default, newest first on request, paginated', async () => {
      const asc = await as(ctx, member, orgId).get(
        `/api/v1/conversations/${conversation.id}/messages?pageSize=2`,
      );
      expect(asc.body.meta).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
      expect(asc.body.data.map((m: MessageWithAuthor) => m.role)).toEqual(['agent', 'customer']);
      const desc = await as(ctx, member, orgId).get(
        `/api/v1/conversations/${conversation.id}/messages?sortOrder=desc&pageSize=2`,
      );
      expect(desc.body.data.map((m: MessageWithAuthor) => m.role)).toEqual(['system', 'agent']);
      expect(
        (await as(ctx, member, orgId).get(`/api/v1/conversations/${UNKNOWN_ID}/messages`)).status,
      ).toBe(404);
    });

    it('a resolved conversation reopens on a new message; an archived one rejects with 409', async () => {
      const resolve = await as(ctx, member, orgId)
        .patch(`/api/v1/conversations/${conversation.id}`)
        .send({ status: 'resolved' });
      expect(resolve.status).toBe(200);
      expect(resolve.body.data.status).toBe('resolved');

      const reopen = await as(ctx, member, orgId)
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .send({ role: 'customer', content: 'One more thing…' });
      expect(reopen.status).toBe(201);
      const afterReopen = await as(ctx, member, orgId).get(
        `/api/v1/conversations/${conversation.id}`,
      );
      expect(afterReopen.body.data.status).toBe('open');
      expect(afterReopen.body.data.messageCount).toBe(5);
      const reopened = await ctx.prisma.client.auditLog.findFirst({
        where: {
          organizationId: orgId,
          action: AuditAction.CONVERSATION_UPDATED,
          targetId: conversation.id,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(reopened?.metadata).toMatchObject({ kind: 'reopened', from: 'resolved', to: 'open' });

      const archive = await as(ctx, member, orgId)
        .patch(`/api/v1/conversations/${conversation.id}`)
        .send({ status: 'archived' });
      expect(archive.status).toBe(200);
      const blocked = await as(ctx, member, orgId)
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .send({ content: 'Too late' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe(ErrorCode.CONFLICT);
      expect(
        (await as(ctx, member, orgId).get(`/api/v1/conversations/${conversation.id}`)).body.data
          .messageCount,
      ).toBe(5);
      // reopen for the assignment tests
      await as(ctx, member, orgId)
        .patch(`/api/v1/conversations/${conversation.id}`)
        .send({ status: 'open' });
    });
  });

  describe('update & assignment', () => {
    it('PATCH updates subject and links; unknown ids → 404', async () => {
      const res = await as(ctx, member, orgId)
        .patch(`/api/v1/conversations/${conversation.id}`)
        .send({ subject: 'Onboarding call (rescheduled)', leadId: null });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ subject: 'Onboarding call (rescheduled)', lead: null });
      expect(
        (await as(ctx, member, orgId).patch(`/api/v1/conversations/${UNKNOWN_ID}`).send({})).status,
      ).toBe(404);
      const badLead = await as(ctx, member, orgId)
        .patch(`/api/v1/conversations/${conversation.id}`)
        .send({ leadId: UNKNOWN_ID });
      expect(badLead.status).toBe(400);
    });

    it('a member can take a conversation but not hand it to someone else; assign notifies the assignee', async () => {
      const denied = await as(ctx, member, orgId)
        .patch(`/api/v1/conversations/${conversation.id}`)
        .send({ assigneeId: owner.user.id });
      expect(denied.status).toBe(403);
      const deniedAssign = await as(ctx, member, orgId)
        .post(`/api/v1/conversations/${conversation.id}/assign`)
        .send({ assigneeId: owner.user.id });
      expect(deniedAssign.status).toBe(403);

      const self = await as(ctx, member, orgId)
        .patch(`/api/v1/conversations/${conversation.id}`)
        .send({ assigneeId: member.user.id });
      expect(self.status).toBe(200);
      expect(self.body.data.assignee).toMatchObject({ id: member.user.id });
      expect(await ctx.prisma.client.notification.count()).toBe(0);

      const bad = await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${conversation.id}/assign`)
        .send({ assigneeId: outsider.user.id });
      expect(bad.status).toBe(400);

      const toOwner = await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${conversation.id}/assign`)
        .send({ assigneeId: owner.user.id });
      expect(toOwner.status).toBe(200);
      const back = await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${conversation.id}/assign`)
        .send({ assigneeId: member.user.id });
      expect(back.status).toBe(200);
      const notif = await ctx.prisma.client.notification.findFirst({
        where: { userId: member.user.id, type: 'conversation_assigned' },
      });
      expect(notif).toMatchObject({
        organizationId: orgId,
        link: `/conversations/${conversation.id}`,
        data: { conversationId: conversation.id, assignedBy: owner.user.id },
      });
      expect(await ctx.prisma.client.notification.count()).toBe(1);

      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: {
          organizationId: orgId,
          action: AuditAction.CONVERSATION_UPDATED,
          targetId: conversation.id,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toMatchObject({ kind: 'assign', to: member.user.id });

      const unassign = await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${conversation.id}/assign`)
        .send({ assigneeId: null });
      expect(unassign.body.data.assignee).toBeNull();
    });
  });
});
