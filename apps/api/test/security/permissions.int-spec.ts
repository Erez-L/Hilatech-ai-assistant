import { AuditAction, ErrorCode, type Role } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
  uniqueEmail,
} from '../setup/test-app';

describe('Security: permission enforcement for the member role', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgId: string;
  let roles: Record<string, Role>;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx);
    member = await register(ctx);
    orgId = (await createOrganization(ctx, owner, 'Perms Co')).id;
    roles = Object.fromEntries(
      ((await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[]).map((r) => [
        r.key,
        r,
      ]),
    );
    await ctx.prisma.client.organizationMember.create({
      data: { organizationId: orgId, userId: member.user.id, roleId: roles.member!.id },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('allows what the member role grants', async () => {
    expect((await as(ctx, member, orgId).get('/api/v1/organizations/current')).status).toBe(200);
    expect((await as(ctx, member, orgId).get('/api/v1/members')).status).toBe(200);
    expect((await as(ctx, member, orgId).get('/api/v1/roles')).status).toBe(200);
    expect((await as(ctx, member, orgId).get('/api/v1/analytics/dashboard')).status).toBe(200);
    expect((await as(ctx, member, orgId).get('/api/v1/billing/subscription')).status).toBe(200);
  });

  const denied: Array<
    [
      string,
      (a: ReturnType<typeof as>) => Promise<{ status: number; body: { error: { code: string } } }>,
    ]
  > = [
    [
      'PATCH /organizations/current',
      (a) => a.patch('/api/v1/organizations/current').send({ name: 'x' }),
    ],
    ['DELETE /organizations/current', (a) => a.delete('/api/v1/organizations/current')],
    [
      'PUT /organizations/current/settings',
      (a) => a.put('/api/v1/organizations/current/settings').send({}),
    ],
    [
      'POST /invitations',
      (a) =>
        a
          .post('/api/v1/invitations')
          .send({ email: uniqueEmail(), roleId: '00000000-0000-4000-8000-000000000000' }),
    ],
    ['GET /invitations', (a) => a.get('/api/v1/invitations')],
    ['POST /roles', (a) => a.post('/api/v1/roles').send({ key: 'x', name: 'X', permissions: [] })],
    [
      'PATCH /roles/:id',
      (a) => a.patch('/api/v1/roles/00000000-0000-4000-8000-000000000000').send({ name: 'x' }),
    ],
    ['DELETE /roles/:id', (a) => a.delete('/api/v1/roles/00000000-0000-4000-8000-000000000000')],
    [
      'PATCH /members/:id',
      (a) =>
        a
          .patch('/api/v1/members/00000000-0000-4000-8000-000000000000')
          .send({ status: 'suspended' }),
    ],
    [
      'DELETE /members/:id',
      (a) => a.delete('/api/v1/members/00000000-0000-4000-8000-000000000000'),
    ],
    ['GET /audit-logs', (a) => a.get('/api/v1/audit-logs')],
  ];

  it.each(denied)('%s → 403 FORBIDDEN for a member', async (_label, call) => {
    const res = await call(as(ctx, member, orgId));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('every denial is audited as security.permission_denied with the missing permissions', async () => {
    const rows = await ctx.prisma.client.auditLog.findMany({
      where: {
        action: AuditAction.PERMISSION_DENIED,
        organizationId: orgId,
        actorUserId: member.user.id,
      },
    });
    expect(rows.length).toBe(denied.length);
    expect(rows.every((r) => Array.isArray((r.metadata as { missing: unknown[] }).missing))).toBe(
      true,
    );
  });

  it('the owner can read those denials in the audit log; the member cannot read audit logs at all', async () => {
    const res = await as(ctx, owner, orgId).get(
      '/api/v1/audit-logs?action=security.permission_denied&pageSize=100',
    );
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(denied.length);
  });

  it('a suspended member is treated as a non-member', async () => {
    await ctx.prisma.client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: member.user.id },
      data: { status: 'suspended' },
    });
    const res = await as(ctx, member, orgId).get('/api/v1/organizations/current');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
    const list = await as(ctx, member).get('/api/v1/organizations');
    expect(list.body.data).toEqual([]);
  });
});
