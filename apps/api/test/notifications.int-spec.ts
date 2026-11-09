import { ErrorCode, type Notification, QueueName, type Role } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  jobsOn,
  register,
  resetDatabase,
} from './setup/test-app';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Notifications', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    orgA = (await createOrganization(ctx, owner, 'Org A')).id;
    orgB = (await createOrganization(ctx, owner, 'Org B')).id;
    for (const orgId of [orgA, orgB]) {
      const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
      await ctx.prisma.client.organizationMember.create({
        data: {
          organizationId: orgId,
          userId: member.user.id,
          roleId: roles.find((r) => r.key === 'member')!.id,
          status: 'active',
        },
      });
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function assignLeadTo(orgId: string, title: string, assigneeId: string) {
    const lead = await as(ctx, owner, orgId).post('/api/v1/leads').send({ title });
    expect(lead.status).toBe(201);
    const res = await as(ctx, owner, orgId)
      .post(`/api/v1/leads/${lead.body.data.id}/assign`)
      .send({ assigneeId });
    expect(res.status).toBe(200);
    return lead.body.data.id as string;
  }

  describe('preferences', () => {
    it('default preferences are empty and PUT persists them under User.preferences.notifications', async () => {
      const before = await as(ctx, member).get('/api/v1/notifications/preferences');
      expect(before.status).toBe(200);
      expect(before.body.data).toEqual({});

      // user-level: works with or without an organization header
      const put = await as(ctx, member, orgA)
        .put('/api/v1/notifications/preferences')
        .send({ inApp: { conversation_assigned: false }, email: { lead_assigned: true } });
      expect(put.status).toBe(200);
      expect(put.body.data).toEqual({
        inApp: { conversation_assigned: false },
        email: { lead_assigned: true },
      });
      const after = await as(ctx, member).get('/api/v1/notifications/preferences');
      expect(after.body.data).toEqual(put.body.data);

      const user = await ctx.prisma.client.user.findUnique({ where: { id: member.user.id } });
      expect(user?.preferences).toMatchObject({
        theme: 'system',
        locale: 'en',
        notifications: { inApp: { conversation_assigned: false }, email: { lead_assigned: true } },
      });
      // and it is the same document the generic preferences endpoint exposes
      const generic = await as(ctx, member).get('/api/v1/users/me/preferences');
      expect(generic.body.data.notifications).toEqual(put.body.data);

      const invalid = await as(ctx, member)
        .put('/api/v1/notifications/preferences')
        .send({ inApp: { not_a_type: true } });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe('delivery', () => {
    it('writes the in-app row synchronously and enqueues an email only when opted in', async () => {
      const leadId = await assignLeadTo(orgA, 'Emailed lead', member.user.id);
      const rows = await ctx.prisma.client.notification.findMany({
        where: { userId: member.user.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ organizationId: orgA, type: 'lead_assigned', readAt: null });

      const emails = (await jobsOn(ctx, QueueName.EMAIL)).filter(
        (j) => j.data.to === member.email && j.data.template === 'generic',
      );
      expect(emails).toHaveLength(1);
      expect(emails[0]!.id).toBe(`notif-email-${rows[0]!.id}`);
      expect(emails[0]!.data).toMatchObject({
        organizationId: orgA,
        variables: expect.objectContaining({ ctaUrl: `/leads/${leadId}`, ctaLabel: 'Open' }),
      });

      // conversation_assigned is disabled in-app for Mia and has no email opt-in → nothing at all
      const conv = await as(ctx, owner, orgA)
        .post('/api/v1/conversations')
        .send({ subject: 'Quiet', assigneeId: member.user.id });
      expect(conv.status).toBe(201);
      expect(
        await ctx.prisma.client.notification.count({ where: { userId: member.user.id } }),
      ).toBe(1);
      expect(
        (await jobsOn(ctx, QueueName.EMAIL)).filter(
          (j) => j.data.to === member.email && j.data.template === 'generic',
        ),
      ).toHaveLength(1);
    });
  });

  describe('listing & reading', () => {
    let a1: string;
    let a2: string;
    let b1: string;

    beforeAll(async () => {
      // reset Mia's preferences so every type is delivered in-app from here on
      await as(ctx, member).put('/api/v1/notifications/preferences').send({});
      await assignLeadTo(orgA, 'Second A lead', member.user.id);
      await assignLeadTo(orgB, 'B lead', member.user.id);
      // a platform-wide (organization-less) notification is visible from every organization
      await ctx.prisma.client.notification.create({
        data: { userId: member.user.id, type: 'system', title: 'Welcome to HilaTech' },
      });
      // someone else's notification must never show up
      await ctx.prisma.client.notification.create({
        data: { organizationId: orgA, userId: owner.user.id, type: 'system', title: 'Owner only' },
      });
    });

    it('GET /notifications is scoped to the caller and the selected org (plus org-less rows), newest first', async () => {
      const inA = await as(ctx, member, orgA).get('/api/v1/notifications');
      expect(inA.status).toBe(200);
      expect(inA.body.meta.total).toBe(3); // two org A leads + the platform-wide one
      const titles = inA.body.data.map((n: Notification) => n.title);
      expect(titles[0]).toBe('Welcome to HilaTech');
      expect(titles).not.toContain('Owner only');
      for (const n of inA.body.data as Notification[]) {
        expect(n.userId).toBe(member.user.id);
        expect([orgA, null]).toContain(n.organizationId);
      }
      const inB = await as(ctx, member, orgB).get('/api/v1/notifications');
      expect(inB.body.meta.total).toBe(2);
      expect(inB.body.data.map((n: Notification) => n.organizationId).sort()).toEqual(
        [orgB, null].sort(),
      );
      [a1, a2] = (inA.body.data as Notification[])
        .filter((n) => n.organizationId === orgA)
        .map((n) => n.id) as [string, string];
      b1 = (inB.body.data as Notification[]).find((n) => n.organizationId === orgB)!.id;

      const ownerView = await as(ctx, owner, orgA).get('/api/v1/notifications');
      expect(ownerView.body.data.map((n: Notification) => n.title)).toEqual(['Owner only']);
    });

    it('unread filter and unread-count track reads; foreign or other-org ids are 404', async () => {
      expect(
        (await as(ctx, member, orgA).get('/api/v1/notifications/unread-count')).body.data,
      ).toEqual({
        unread: 3,
      });

      const read = await as(ctx, member, orgA).post(`/api/v1/notifications/${a1}/read`);
      expect(read.status).toBe(200);
      expect(read.body.data.readAt).toEqual(expect.any(String));
      // idempotent
      const again = await as(ctx, member, orgA).post(`/api/v1/notifications/${a1}/read`);
      expect(again.body.data.readAt).toBe(read.body.data.readAt);

      expect(
        (await as(ctx, member, orgA).get('/api/v1/notifications/unread-count')).body.data,
      ).toEqual({
        unread: 2,
      });
      const unread = await as(ctx, member, orgA).get('/api/v1/notifications?unread=true');
      expect(unread.body.meta.total).toBe(2);
      expect(unread.body.data.map((n: Notification) => n.id)).not.toContain(a1);
      const all = await as(ctx, member, orgA).get('/api/v1/notifications?unread=false');
      expect(all.body.meta.total).toBe(3);

      // the owner cannot read Mia's row; Mia cannot read an org B row while scoped to org A
      expect((await as(ctx, owner, orgA).post(`/api/v1/notifications/${a2}/read`)).status).toBe(
        404,
      );
      expect((await as(ctx, member, orgA).post(`/api/v1/notifications/${b1}/read`)).status).toBe(
        404,
      );
      expect(
        (await as(ctx, member, orgA).post(`/api/v1/notifications/${UNKNOWN_ID}/read`)).status,
      ).toBe(404);
      const b1Row = await ctx.prisma.client.notification.findUnique({ where: { id: b1 } });
      expect(b1Row?.readAt).toBeNull();
    });

    it('read-all marks only the caller’s rows visible in this organization', async () => {
      const res = await as(ctx, member, orgA).post('/api/v1/notifications/read-all');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ updated: 2 });
      expect(
        (await as(ctx, member, orgA).get('/api/v1/notifications/unread-count')).body.data,
      ).toEqual({
        unread: 0,
      });
      // org B row untouched, owner's row untouched
      expect(
        (await as(ctx, member, orgB).get('/api/v1/notifications/unread-count')).body.data,
      ).toEqual({
        unread: 1,
      });
      expect(
        (await as(ctx, owner, orgA).get('/api/v1/notifications/unread-count')).body.data,
      ).toEqual({
        unread: 1,
      });
      expect(
        (await as(ctx, member, orgA).post('/api/v1/notifications/read-all')).body.data,
      ).toEqual({
        updated: 0,
      });
    });

    it('requires an organization for the tenant-scoped endpoints', async () => {
      const res = await as(ctx, member).get('/api/v1/notifications');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCode.ORGANIZATION_REQUIRED);
    });
  });
});
