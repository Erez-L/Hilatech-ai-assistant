import {
  AuditAction,
  ErrorCode,
  PLAN_LIMITS,
  SYSTEM_ROLE_PERMISSIONS,
  SystemRole,
} from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  anon,
  as,
  createOrganization,
  createTestApp,
  expectNoSensitiveLeak,
  register,
  resetDatabase,
} from './setup/test-app';

describe('Organizations', () => {
  let ctx: TestContext;
  let owner: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Olivia', lastName: 'Owner' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  let orgId: string;

  it('POST /organizations creates the organization, system roles, owner membership and a free subscription', async () => {
    const res = await as(ctx, owner)
      .post('/api/v1/organizations')
      .send({ name: 'Acme Studio', industry: 'Design', timezone: 'Asia/Jerusalem' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Acme Studio',
      slug: 'acme-studio',
      industry: 'Design',
      timezone: 'Asia/Jerusalem',
      locale: 'en',
      settings: {},
    });
    orgId = res.body.data.id;

    const roles = await ctx.prisma.client.role.findMany({
      where: { organizationId: orgId },
      orderBy: { key: 'asc' },
    });
    expect(roles.map((r) => r.key).sort()).toEqual([...Object.values(SystemRole)].sort());
    for (const role of roles) {
      expect(role.isSystem).toBe(true);
      expect([...role.permissions].sort()).toEqual(
        [...SYSTEM_ROLE_PERMISSIONS[role.key as SystemRole]].sort(),
      );
    }

    const membership = await ctx.prisma.client.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: owner.user.id } },
      include: { role: true },
    });
    expect(membership?.status).toBe('active');
    expect(membership?.role.key).toBe('owner');

    const subscription = await ctx.prisma.client.subscription.findUnique({
      where: { organizationId: orgId },
    });
    expect(subscription).toMatchObject({
      plan: 'free',
      status: 'active',
      limits: PLAN_LIMITS.free,
    });

    const audit = await ctx.prisma.client.auditLog.findFirst({
      where: { action: AuditAction.ORG_CREATED, organizationId: orgId },
    });
    expect(audit?.actorUserId).toBe(owner.user.id);
  });

  it('GET /organizations lists the caller organizations with role info; /auth/me resolves permissions', async () => {
    const list = await as(ctx, owner).get('/api/v1/organizations');
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: orgId,
        slug: 'acme-studio',
        roleKey: 'owner',
        roleName: 'Owner',
      }),
    ]);

    const me = await as(ctx, owner, orgId).get('/api/v1/auth/me');
    expect(me.body.data.activeOrganization.id).toBe(orgId);
    expect(me.body.data.permissions).toEqual(
      expect.arrayContaining(['organization:delete', 'members:invite']),
    );
    expectNoSensitiveLeak(me.body);
  });

  it('auto-suffixes slugs on name collision and rejects explicit slug conflicts', async () => {
    const second = await createOrganization(ctx, owner, 'Acme Studio');
    expect(second.slug).toMatch(/^acme-studio-[a-z0-9]{4}$/);

    const conflict = await as(ctx, owner)
      .post('/api/v1/organizations')
      .send({ name: 'Other', slug: 'acme-studio' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe(ErrorCode.CONFLICT);
  });

  it('GET/PATCH /organizations/current are tenant scoped and audited', async () => {
    const current = await as(ctx, owner, orgId).get('/api/v1/organizations/current');
    expect(current.status).toBe(200);
    expect(current.body.data.id).toBe(orgId);

    const patch = await as(ctx, owner, orgId)
      .patch('/api/v1/organizations/current')
      .send({ website: 'https://acme.example', description: 'We design.' });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toMatchObject({
      website: 'https://acme.example',
      description: 'We design.',
    });

    const invalid = await as(ctx, owner, orgId)
      .patch('/api/v1/organizations/current')
      .send({ website: 'not a url' });
    expect(invalid.status).toBe(400);

    const audit = await ctx.prisma.client.auditLog.findFirst({
      where: { action: AuditAction.ORG_UPDATED, organizationId: orgId },
    });
    expect(audit).not.toBeNull();

    const missingHeader = await as(ctx, owner).get('/api/v1/organizations/current');
    expect(missingHeader.status).toBe(400);
    expect(missingHeader.body.error.code).toBe(ErrorCode.ORGANIZATION_REQUIRED);
  });

  it('PUT/GET /organizations/current/settings validate against the strict settings schema', async () => {
    const settings = {
      businessHours: {
        timezone: 'Asia/Jerusalem',
        days: { sun: { open: '09:00', close: '18:00' }, sat: null },
      },
      branding: { primaryColor: '#3366ff' },
      ai: { defaultProvider: 'anthropic', tone: 'friendly' },
    };
    const put = await as(ctx, owner, orgId)
      .put('/api/v1/organizations/current/settings')
      .send(settings);
    expect(put.status).toBe(200);
    expect(put.body.data).toEqual(settings);

    const get = await as(ctx, owner, orgId).get('/api/v1/organizations/current/settings');
    expect(get.body.data).toEqual(settings);

    const unknownKey = await as(ctx, owner, orgId)
      .put('/api/v1/organizations/current/settings')
      .send({ ...settings, evil: true });
    expect(unknownKey.status).toBe(400);
    expect(unknownKey.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

    const org = await as(ctx, owner, orgId).get('/api/v1/organizations/current');
    expect(org.body.data.settings).toEqual(settings);
  });

  it('GET /billing/* and /analytics/dashboard reflect the new organization', async () => {
    const subscription = await as(ctx, owner, orgId).get('/api/v1/billing/subscription');
    expect(subscription.status).toBe(200);
    expect(subscription.body.data).toMatchObject({ plan: 'free', limits: PLAN_LIMITS.free });

    const usage = await as(ctx, owner, orgId).get('/api/v1/billing/usage');
    expect(usage.status).toBe(200);
    expect(usage.body.data.metrics.ai_tokens).toEqual({
      used: 0,
      limit: PLAN_LIMITS.free.aiTokensPerMonth,
    });

    const plans = await as(ctx, owner).get('/api/v1/billing/plans');
    expect(plans.status).toBe(200);
    expect(plans.body.data.map((p: { key: string }) => p.key)).toEqual([
      'free',
      'starter',
      'pro',
      'enterprise',
    ]);

    const dashboard = await as(ctx, owner, orgId).get('/api/v1/analytics/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data).toMatchObject({
      members: { active: 1, suspended: 0 },
      invitations: { pending: 0 },
      contacts: { total: 0 },
      leads: { total: 0 },
    });
  });

  it('GET /audit-logs is paginated, filterable and scoped to the organization', async () => {
    const res = await as(ctx, owner, orgId).get(
      '/api/v1/audit-logs?pageSize=2&action=organization.updated',
    );
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 1, totalPages: 1 });
    expect(res.body.data[0]).toMatchObject({
      action: 'organization.updated',
      organizationId: orgId,
      actorUserId: owner.user.id,
    });
    expect(res.body.data[0].requestId).toBeTruthy();

    const invalid = await as(ctx, owner, orgId).get('/api/v1/audit-logs?from=yesterday');
    expect(invalid.status).toBe(400);
  });

  it('DELETE /organizations/current soft-deletes (owner only) and the organization disappears from tenant resolution', async () => {
    const victim = await createOrganization(ctx, owner, 'Doomed');
    const del = await as(ctx, owner, victim.id).delete('/api/v1/organizations/current');
    expect(del.status).toBe(204);

    const row = await ctx.prisma.client.organization.findUnique({ where: { id: victim.id } });
    expect(row?.deletedAt).not.toBeNull();

    const after = await as(ctx, owner, victim.id).get('/api/v1/organizations/current');
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);

    const list = await as(ctx, owner).get('/api/v1/organizations');
    expect(list.body.data.map((o: { id: string }) => o.id)).not.toContain(victim.id);
  });

  it('public preview endpoint rejects malformed tokens; unknown routes return the NOT_FOUND envelope', async () => {
    const preview = await anon(ctx).get('/api/v1/invitations/preview?token=short');
    expect(preview.status).toBe(400);
    const missing = await as(ctx, owner).get('/api/v1/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe(ErrorCode.NOT_FOUND);
    expect(missing.body.error.requestId).toBeTruthy();
  });
});
