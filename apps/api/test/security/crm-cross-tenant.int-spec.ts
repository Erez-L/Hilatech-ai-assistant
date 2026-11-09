import {
  AuditAction,
  type Contact,
  type ConversationWithRelations,
  ErrorCode,
  type LeadWithRelations,
  type Role,
} from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from '../setup/test-app';

/**
 * Tenant isolation for the CRM modules: org A users must never see or touch org B contacts, leads,
 * conversations, notes, messages or notifications — neither through forged headers (403) nor by guessing
 * ids while scoped to their own organization (404, never 403, so existence does not leak). Also checks the
 * `member` system role boundaries (create/update yes, assign/delete no).
 */
describe('Security: CRM cross-tenant isolation & member role', () => {
  let ctx: TestContext;
  let userA: Actor;
  let userB: Actor;
  let memberA: Actor;
  let orgA: string;
  let orgB: string;
  let contactB: Contact;
  let leadB: LeadWithRelations;
  let conversationB: ConversationWithRelations;
  let noteB: string;
  let notificationB: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userA = await register(ctx, { firstName: 'Alice', lastName: 'A' });
    userB = await register(ctx, { firstName: 'Bob', lastName: 'B' });
    memberA = await register(ctx, { firstName: 'Mel', lastName: 'Member' });
    orgA = (await createOrganization(ctx, userA, 'Org A')).id;
    orgB = (await createOrganization(ctx, userB, 'Org B')).id;
    const rolesA = (await as(ctx, userA, orgA).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgA,
        userId: memberA.user.id,
        roleId: rolesA.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });

    // Org B data
    contactB = (
      await as(ctx, userB, orgB)
        .post('/api/v1/contacts')
        .send({
          firstName: 'Secret',
          lastName: 'Customer',
          email: 'secret@orgb.test',
          tags: ['b-only'],
        })
    ).body.data;
    leadB = (
      await as(ctx, userB, orgB)
        .post('/api/v1/leads')
        .send({ title: 'Org B confidential deal', contactId: contactB.id, value: 99999 })
    ).body.data;
    noteB = (
      await as(ctx, userB, orgB)
        .post(`/api/v1/leads/${leadB.id}/notes`)
        .send({ body: 'B-private note' })
    ).body.data.id;
    conversationB = (
      await as(ctx, userB, orgB).post('/api/v1/conversations').send({
        subject: 'Org B private thread',
        contactId: contactB.id,
        initialMessage: 'B secret',
      })
    ).body.data;
    notificationB = (
      await ctx.prisma.client.notification.create({
        data: { organizationId: orgB, userId: userB.user.id, type: 'system', title: 'B notice' },
      })
    ).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  const forgedReads = [
    '/api/v1/contacts',
    '/api/v1/contacts/tags',
    '/api/v1/leads',
    '/api/v1/conversations',
    '/api/v1/notifications',
    '/api/v1/notifications/unread-count',
    '/api/v1/analytics/dashboard',
  ];

  it.each(forgedReads)('%s with a forged x-organization-id → 403 NOT_A_MEMBER', async (url) => {
    const res = await as(ctx, userA, orgB).get(url);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
    expect(JSON.stringify(res.body)).not.toMatch(/Org B|Secret|confidential/);
  });

  it('org B resources are 404 for org A (read, update, delete, assign, sub-resources)', async () => {
    const a = as(ctx, userA, orgA);
    const attempts: Array<Promise<{ status: number; body: unknown }>> = [
      a.get(`/api/v1/contacts/${contactB.id}`),
      a.patch(`/api/v1/contacts/${contactB.id}`).send({ firstName: 'Pwned' }),
      a.delete(`/api/v1/contacts/${contactB.id}`),
      a.get(`/api/v1/leads/${leadB.id}`),
      a.patch(`/api/v1/leads/${leadB.id}`).send({ title: 'Pwned' }),
      a.delete(`/api/v1/leads/${leadB.id}`),
      a.post(`/api/v1/leads/${leadB.id}/assign`).send({ assigneeId: userA.user.id }),
      a.post(`/api/v1/leads/${leadB.id}/convert`).send({ contact: { firstName: 'X' } }),
      a.get(`/api/v1/leads/${leadB.id}/notes`),
      a.post(`/api/v1/leads/${leadB.id}/notes`).send({ body: 'injected' }),
      a.delete(`/api/v1/leads/${leadB.id}/notes/${noteB}`),
      a.get(`/api/v1/leads/${leadB.id}/activities`),
      a.get(`/api/v1/conversations/${conversationB.id}`),
      a.patch(`/api/v1/conversations/${conversationB.id}`).send({ subject: 'Pwned' }),
      a
        .post(`/api/v1/conversations/${conversationB.id}/assign`)
        .send({ assigneeId: userA.user.id }),
      a.get(`/api/v1/conversations/${conversationB.id}/messages`),
      a.post(`/api/v1/conversations/${conversationB.id}/messages`).send({ content: 'injected' }),
      a.post(`/api/v1/notifications/${notificationB}/read`),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/Org B|Secret|confidential|B-private/);
    }

    // nothing changed in org B
    expect(
      await ctx.prisma.client.contact.findUnique({ where: { id: contactB.id } }),
    ).toMatchObject({
      firstName: 'Secret',
      deletedAt: null,
    });
    expect(await ctx.prisma.client.lead.findUnique({ where: { id: leadB.id } })).toMatchObject({
      title: 'Org B confidential deal',
      assigneeId: null,
      convertedAt: null,
      deletedAt: null,
    });
    expect(await ctx.prisma.client.leadNote.count({ where: { leadId: leadB.id } })).toBe(1);
    expect(await ctx.prisma.client.leadActivity.count({ where: { leadId: leadB.id } })).toBe(2);
    expect(
      await ctx.prisma.client.conversation.findUnique({ where: { id: conversationB.id } }),
    ).toMatchObject({ subject: 'Org B private thread', assigneeId: null, messageCount: 1 });
    expect(
      await ctx.prisma.client.notification.findUnique({ where: { id: notificationB } }),
    ).toMatchObject({ readAt: null });
  });

  it('org B ids used as references from org A are rejected as validation errors (no linking across tenants)', async () => {
    const a = as(ctx, userA, orgA);
    const leadWithBContact = await a
      .post('/api/v1/leads')
      .send({ title: 'x', contactId: contactB.id });
    expect(leadWithBContact.status).toBe(400);
    expect(leadWithBContact.body.error.details[0].path).toBe('contactId');
    const leadWithBAssignee = await a
      .post('/api/v1/leads')
      .send({ title: 'x', assigneeId: userB.user.id });
    expect(leadWithBAssignee.status).toBe(400);
    expect(leadWithBAssignee.body.error.details[0].path).toBe('assigneeId');
    const contactWithBOwner = await a
      .post('/api/v1/contacts')
      .send({ firstName: 'x', ownerId: userB.user.id });
    expect(contactWithBOwner.status).toBe(400);
    const convWithB = await a
      .post('/api/v1/conversations')
      .send({ contactId: contactB.id, leadId: leadB.id });
    expect(convWithB.status).toBe(400);
    const convert = await a.post('/api/v1/leads').send({ title: 'to convert' });
    const convertWithB = await a
      .post(`/api/v1/leads/${convert.body.data.id}/convert`)
      .send({ contactId: contactB.id });
    expect(convertWithB.status).toBe(400);
    expect(await ctx.prisma.client.lead.count({ where: { organizationId: orgA } })).toBe(1);
    expect(await ctx.prisma.client.conversation.count({ where: { organizationId: orgA } })).toBe(0);
  });

  it('listings and search of org A never include org B rows', async () => {
    const a = as(ctx, userA, orgA);
    const [contacts, leads, conversations, tags, bySearch, notifications] = await Promise.all([
      a.get('/api/v1/contacts?pageSize=100'),
      a.get('/api/v1/leads?pageSize=100'),
      a.get('/api/v1/conversations?pageSize=100'),
      a.get('/api/v1/contacts/tags'),
      a.get('/api/v1/leads?search=confidential'),
      a.get('/api/v1/notifications'),
    ]);
    for (const row of contacts.body.data as Contact[]) expect(row.organizationId).toBe(orgA);
    for (const row of leads.body.data as LeadWithRelations[]) expect(row.organizationId).toBe(orgA);
    for (const row of conversations.body.data as ConversationWithRelations[]) {
      expect(row.organizationId).toBe(orgA);
    }
    expect(contacts.body.data.some((c: Contact) => c.id === contactB.id)).toBe(false);
    expect(tags.body.data).not.toContain('b-only');
    expect(bySearch.body.data).toEqual([]);
    expect(notifications.body.data).toEqual([]);
    const filteredByBContact = await a.get(`/api/v1/leads?contactId=${contactB.id}`);
    expect(filteredByBContact.body.data).toEqual([]);
  });

  it('dashboard numbers of org A are not influenced by org B data', async () => {
    const res = await as(ctx, userA, orgA).get('/api/v1/analytics/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.contacts.total).toBe(0);
    expect(res.body.data.leads.total).toBe(1);
    expect(res.body.data.leads.pipelineValue).toBe(0);
    expect(res.body.data.conversations.total).toBe(0);
    expect(res.body.data.recentLeads.map((l: { title: string }) => l.title)).toEqual([
      'to convert',
    ]);
  });

  it('forged attempts are audited as tenant violations, invisible from org B audit logs', async () => {
    const attempts = await ctx.prisma.client.auditLog.count({
      where: { action: AuditAction.TENANT_VIOLATION_ATTEMPT, actorUserId: userA.user.id },
    });
    expect(attempts).toBeGreaterThanOrEqual(forgedReads.length);
    const visibleToB = await as(ctx, userB, orgB).get(
      '/api/v1/audit-logs?action=security.tenant_violation_attempt',
    );
    expect(visibleToB.body.data).toEqual([]);
  });

  describe('member role (SYSTEM_ROLE_PERMISSIONS.member)', () => {
    it('can create and update contacts/leads/conversations but cannot assign or delete', async () => {
      const m = as(ctx, memberA, orgA);
      const contact = await m.post('/api/v1/contacts').send({ firstName: 'Mine' });
      expect(contact.status).toBe(201);
      const lead = await m
        .post('/api/v1/leads')
        .send({ title: 'Member lead', contactId: contact.body.data.id });
      expect(lead.status).toBe(201);
      expect(
        (await m.patch(`/api/v1/leads/${lead.body.data.id}`).send({ status: 'contacted' })).status,
      ).toBe(200);
      const conversation = await m.post('/api/v1/conversations').send({ subject: 'Member thread' });
      expect(conversation.status).toBe(201);
      expect(
        (
          await m
            .post(`/api/v1/conversations/${conversation.body.data.id}/messages`)
            .send({ content: 'hi' })
        ).status,
      ).toBe(201);

      const denied = await Promise.all([
        m.post(`/api/v1/leads/${lead.body.data.id}/assign`).send({ assigneeId: userA.user.id }),
        m.delete(`/api/v1/leads/${lead.body.data.id}`),
        m.delete(`/api/v1/contacts/${contact.body.data.id}`),
        m
          .post(`/api/v1/conversations/${conversation.body.data.id}/assign`)
          .send({ assigneeId: userA.user.id }),
        // the PATCH back door is closed too
        m.patch(`/api/v1/leads/${lead.body.data.id}`).send({ assigneeId: userA.user.id }),
        m
          .patch(`/api/v1/conversations/${conversation.body.data.id}`)
          .send({ assigneeId: userA.user.id }),
      ]);
      for (const res of denied) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
      }
      const permissionDenials = await ctx.prisma.client.auditLog.count({
        where: {
          organizationId: orgA,
          action: AuditAction.PERMISSION_DENIED,
          actorUserId: memberA.user.id,
        },
      });
      expect(permissionDenials).toBe(4); // guard-level denials; the two PATCH denials are service-level
      expect(
        await ctx.prisma.client.lead.findUnique({ where: { id: lead.body.data.id } }),
      ).toMatchObject({ assigneeId: null, deletedAt: null });
    });
  });
});
