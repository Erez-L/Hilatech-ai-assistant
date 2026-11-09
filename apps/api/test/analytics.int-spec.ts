import { type DashboardSummary, ErrorCode, type Role } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from './setup/test-app';

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

describe('Analytics dashboard', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    orgId = (await createOrganization(ctx, owner, 'Numbers Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'suspended',
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function dashboard(period?: string): Promise<DashboardSummary> {
    const res = await as(ctx, owner, orgId).get(
      `/api/v1/analytics/dashboard${period ? `?period=${period}` : ''}`,
    );
    expect(res.status).toBe(200);
    return res.body.data;
  }

  it('starts from zero everywhere (never static placeholders) with a complete, zero-filled series', async () => {
    const data = await dashboard();
    expect(data.period.key).toBe('30d');
    expect(data.members).toEqual({ active: 1, suspended: 1 });
    expect(data.contacts).toEqual({ total: 0, newInPeriod: 0 });
    expect(data.leads).toMatchObject({
      total: 0,
      open: 0,
      pipelineValue: 0,
      wonValueInPeriod: 0,
      currency: 'USD',
    });
    expect(Object.keys(data.leads.byStatus).sort()).toEqual(
      ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'].sort(),
    );
    expect(Object.values(data.leads.bySource).every((n) => n === 0)).toBe(true);
    expect(data.conversations).toMatchObject({ total: 0, open: 0, pending: 0, unassigned: 0 });
    expect(data.series.leadsCreated).toHaveLength(30);
    expect(data.series.conversationsCreated).toHaveLength(30);
    expect(data.series.leadsCreated.every((p) => p.count === 0)).toBe(true);
    expect(data.series.leadsCreated.at(-1)!.date).toBe(isoDay(new Date()));
    expect(data.recentLeads).toEqual([]);
    expect(data.recentConversations).toEqual([]);
  });

  it('reflects created data: counts, pipeline, won/lost in period, series buckets and recents', async () => {
    const o = as(ctx, owner, orgId);
    const contact = (await o.post('/api/v1/contacts').send({ firstName: 'C1' })).body.data;
    const l1 = (
      await o.post('/api/v1/leads').send({ title: 'Open 1', value: 1000, source: 'website' })
    ).body.data;
    const l2 = (
      await o
        .post('/api/v1/leads')
        .send({ title: 'Open 2', value: 250.5, status: 'proposal', source: 'referral' })
    ).body.data;
    const l3 = (await o.post('/api/v1/leads').send({ title: 'Won', value: 5000 })).body.data;
    expect((await o.patch(`/api/v1/leads/${l3.id}`).send({ status: 'won' })).status).toBe(200);
    const l4 = (await o.post('/api/v1/leads').send({ title: 'Lost', value: 70 })).body.data;
    expect((await o.patch(`/api/v1/leads/${l4.id}`).send({ status: 'lost' })).status).toBe(200);
    const deleted = (await o.post('/api/v1/leads').send({ title: 'Deleted', value: 999 })).body
      .data;
    expect((await o.delete(`/api/v1/leads/${deleted.id}`)).status).toBe(204);
    // an old lead outside the 7d window but inside 30d
    const tenDaysAgo = new Date(Date.now() - 10 * DAY_MS);
    await ctx.prisma.client.lead.create({
      data: {
        organizationId: orgId,
        title: 'Old lead',
        value: 100,
        createdAt: tenDaysAgo,
        updatedAt: tenDaysAgo,
      },
    });

    const c1 = (
      await o
        .post('/api/v1/conversations')
        .send({ subject: 'Open conv', channel: 'web', contactId: contact.id, initialMessage: 'hi' })
    ).body.data;
    const c2 = (
      await o.post('/api/v1/conversations').send({ subject: 'Pending', channel: 'email' })
    ).body.data;
    expect(
      (await o.patch(`/api/v1/conversations/${c2.id}`).send({ status: 'pending' })).status,
    ).toBe(200);
    const c3 = (
      await o.post('/api/v1/conversations').send({ subject: 'Assigned', assigneeId: owner.user.id })
    ).body.data;
    const c4 = (await o.post('/api/v1/conversations').send({ subject: 'Resolved' })).body.data;
    expect(
      (await o.patch(`/api/v1/conversations/${c4.id}`).send({ status: 'resolved' })).status,
    ).toBe(200);
    await ctx.prisma.client.invitation.create({
      data: {
        organizationId: orgId,
        email: 'pending@invite.test',
        roleId: (
          await ctx.prisma.client.role.findFirstOrThrow({
            where: { organizationId: orgId, key: 'member' },
          })
        ).id,
        tokenHash: 'x'.repeat(64),
        invitedByUserId: owner.user.id,
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    });

    const data = await dashboard('30d');
    expect(data.invitations.pending).toBe(1);
    expect(data.contacts).toEqual({ total: 1, newInPeriod: 1 });
    expect(data.leads).toMatchObject({
      total: 5, // 4 live + the old one; the deleted one is excluded
      open: 3,
      newInPeriod: 5,
      wonInPeriod: 1,
      lostInPeriod: 1,
      pipelineValue: 1350.5, // 1000 + 250.5 + 100 (old) — won/lost/deleted excluded
      wonValueInPeriod: 5000,
      currency: 'USD',
    });
    expect(data.leads.byStatus).toMatchObject({ new: 2, proposal: 1, won: 1, lost: 1 });
    expect(data.leads.bySource).toMatchObject({ website: 1, referral: 1, other: 3 });
    expect(data.conversations).toMatchObject({
      total: 4,
      open: 2,
      pending: 1,
      unassigned: 2, // open/pending without assignee: c1 and c2 (c3 assigned, c4 resolved)
      newInPeriod: 4,
    });
    expect(data.conversations.byStatus).toMatchObject({
      open: 2,
      pending: 1,
      resolved: 1,
      archived: 0,
    });
    expect(data.conversations.byChannel).toMatchObject({ web: 1, email: 1, internal: 2 });

    const today = isoDay(new Date());
    const todayLeads = data.series.leadsCreated.find((p) => p.date === today);
    expect(todayLeads?.count).toBe(4);
    const oldBucket = data.series.leadsCreated.find((p) => p.date === isoDay(tenDaysAgo));
    expect(oldBucket?.count).toBe(1);
    expect(data.series.leadsCreated.reduce((s, p) => s + p.count, 0)).toBe(5);
    expect(data.series.conversationsCreated.find((p) => p.date === today)?.count).toBe(4);

    expect(data.recentLeads.map((l) => l.id)).toEqual([
      l4.id,
      l3.id,
      l2.id,
      l1.id,
      expect.any(String),
    ]);
    expect(data.recentLeads[0]).toMatchObject({
      title: 'Lost',
      status: 'lost',
      value: 70,
      currency: 'USD',
    });
    expect(data.recentConversations.map((c) => c.id)).toEqual([c4.id, c3.id, c2.id, c1.id]);
    expect(data.recentConversations[3]).toMatchObject({
      subject: 'Open conv',
      status: 'open',
      channel: 'web',
      lastMessageAt: expect.any(String),
    });

    // 7d window: the old lead drops out of newInPeriod and the series, but stays in totals
    const week = await dashboard('7d');
    expect(week.period.key).toBe('7d');
    expect(week.series.leadsCreated).toHaveLength(7);
    expect(week.leads.total).toBe(5);
    expect(week.leads.newInPeriod).toBe(4);
    expect(week.leads.pipelineValue).toBe(1350.5);
    expect(week.series.leadsCreated.reduce((s, p) => s + p.count, 0)).toBe(4);
    expect((await dashboard('90d')).series.leadsCreated).toHaveLength(90);
  });

  it('rejects an unknown period and requires analytics:read', async () => {
    const bad = await as(ctx, owner, orgId).get('/api/v1/analytics/dashboard?period=1y');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    const suspended = await as(ctx, member, orgId).get('/api/v1/analytics/dashboard');
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
  });
});
