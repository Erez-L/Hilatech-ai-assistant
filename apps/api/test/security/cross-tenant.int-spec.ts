import { AuditAction, ErrorCode, type Member, type Role } from '@hilatech/contracts';

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

/**
 * Tenant isolation: user A (owner of org A) must never read or modify anything in org B, whether by
 * forging the `x-organization-id` header or by guessing org B resource ids while scoped to org A.
 */
describe('Security: cross-tenant isolation', () => {
  let ctx: TestContext;
  let userA: Actor;
  let userB: Actor;
  let orgA: string;
  let orgB: string;
  let rolesB: Role[];
  let membersB: Member[];

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userA = await register(ctx, { firstName: 'Alice', lastName: 'A' });
    userB = await register(ctx, { firstName: 'Bob', lastName: 'B' });
    orgA = (await createOrganization(ctx, userA, 'Org A')).id;
    orgB = (await createOrganization(ctx, userB, 'Org B')).id;
    rolesB = (await as(ctx, userB, orgB).get('/api/v1/roles')).body.data;
    membersB = (await as(ctx, userB, orgB).get('/api/v1/members')).body.data;
    await as(ctx, userB, orgB)
      .put('/api/v1/organizations/current/settings')
      .send({ branding: { primaryColor: '#000000' } });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const forgedReads: Array<[string, string]> = [
    ['GET', '/api/v1/organizations/current'],
    ['GET', '/api/v1/organizations/current/settings'],
    ['GET', '/api/v1/members'],
    ['GET', '/api/v1/roles'],
    ['GET', '/api/v1/permissions'],
    ['GET', '/api/v1/invitations'],
    ['GET', '/api/v1/audit-logs'],
    ['GET', '/api/v1/billing/subscription'],
    ['GET', '/api/v1/billing/usage'],
    ['GET', '/api/v1/analytics/dashboard'],
  ];

  it.each(forgedReads)(
    '%s %s with a forged x-organization-id for org B → 403 NOT_A_MEMBER',
    async (_method, url) => {
      const res = await as(ctx, userA, orgB).get(url);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
      expect(JSON.stringify(res.body)).not.toContain('Org B');
    },
  );

  it('forged writes against org B are rejected and nothing changes', async () => {
    const patch = await as(ctx, userA, orgB)
      .patch('/api/v1/organizations/current')
      .send({ name: 'Hacked' });
    expect(patch.status).toBe(403);
    const settings = await as(ctx, userA, orgB)
      .put('/api/v1/organizations/current/settings')
      .send({ branding: { primaryColor: '#ff0000' } });
    expect(settings.status).toBe(403);
    const del = await as(ctx, userA, orgB).delete('/api/v1/organizations/current');
    expect(del.status).toBe(403);
    const role = await as(ctx, userA, orgB)
      .post('/api/v1/roles')
      .send({ key: 'evil', name: 'Evil', permissions: [] });
    expect(role.status).toBe(403);
    const invite = await as(ctx, userA, orgB)
      .post('/api/v1/invitations')
      .send({ email: uniqueEmail(), roleId: rolesB[0]!.id });
    expect(invite.status).toBe(403);
    const member = await as(ctx, userA, orgB)
      .patch(`/api/v1/members/${membersB[0]!.id}`)
      .send({ status: 'suspended' });
    expect(member.status).toBe(403);

    const orgRow = await ctx.prisma.client.organization.findUnique({ where: { id: orgB } });
    expect(orgRow).toMatchObject({
      name: 'Org B',
      deletedAt: null,
      settings: { branding: { primaryColor: '#000000' } },
    });
    expect(await ctx.prisma.client.role.count({ where: { organizationId: orgB } })).toBe(3);
    expect(await ctx.prisma.client.invitation.count({ where: { organizationId: orgB } })).toBe(0);
  });

  it('every forged attempt is audited as security.tenant_violation_attempt with the attempted org id', async () => {
    const attempts = await ctx.prisma.client.auditLog.findMany({
      where: { action: AuditAction.TENANT_VIOLATION_ATTEMPT, actorUserId: userA.user.id },
    });
    expect(attempts.length).toBeGreaterThanOrEqual(forgedReads.length);
    for (const attempt of attempts) {
      expect(attempt.metadata).toMatchObject({ attemptedOrganizationId: orgB });
      expect(attempt.organizationId).toBeNull();
    }
    // and none of them is visible from org B's audit log either (they are not org B events)
    const visibleToB = await as(ctx, userB, orgB).get(
      '/api/v1/audit-logs?action=security.tenant_violation_attempt',
    );
    expect(visibleToB.body.data).toEqual([]);
  });

  it('org B resource ids are invisible when scoped to org A (404, not 403, to avoid existence leaks)', async () => {
    const ownerRoleB = rolesB.find((r) => r.key === 'owner')!;
    const memberB = membersB[0]!;

    expect((await as(ctx, userA, orgA).get(`/api/v1/roles/${ownerRoleB.id}`)).status).toBe(404);
    expect(
      (
        await as(ctx, userA, orgA)
          .patch(`/api/v1/roles/${ownerRoleB.id}`)
          .send({ description: 'pwned' })
      ).status,
    ).toBe(404);
    expect((await as(ctx, userA, orgA).delete(`/api/v1/roles/${ownerRoleB.id}`)).status).toBe(404);
    expect(
      (
        await as(ctx, userA, orgA)
          .patch(`/api/v1/members/${memberB.id}`)
          .send({ status: 'suspended' })
      ).status,
    ).toBe(404);
    expect((await as(ctx, userA, orgA).delete(`/api/v1/members/${memberB.id}`)).status).toBe(404);

    // inviting with a role id that belongs to org B is rejected as invalid input
    const invite = await as(ctx, userA, orgA)
      .post('/api/v1/invitations')
      .send({ email: uniqueEmail(), roleId: ownerRoleB.id });
    expect(invite.status).toBe(400);

    const roleRow = await ctx.prisma.client.role.findUnique({ where: { id: ownerRoleB.id } });
    expect(roleRow?.description).toBeNull();
    const memberRow = await ctx.prisma.client.organizationMember.findUnique({
      where: { id: memberB.id },
    });
    expect(memberRow?.status).toBe('active');
  });

  it('revoking an org B invitation from org A is impossible', async () => {
    const invite = await as(ctx, userB, orgB)
      .post('/api/v1/invitations')
      .send({
        email: uniqueEmail('b-invitee'),
        roleId: rolesB.find((r) => r.key === 'member')!.id,
      });
    expect(invite.status).toBe(201);
    const revoke = await as(ctx, userA, orgA).delete(`/api/v1/invitations/${invite.body.data.id}`);
    expect(revoke.status).toBe(404);
    const row = await ctx.prisma.client.invitation.findUnique({
      where: { id: invite.body.data.id },
    });
    expect(row?.status).toBe('pending');
  });

  it('audit logs and members of org A never include org B rows', async () => {
    const audit = await as(ctx, userA, orgA).get('/api/v1/audit-logs?pageSize=100');
    for (const row of audit.body.data) expect(row.organizationId).toBe(orgA);
    const members = await as(ctx, userA, orgA).get('/api/v1/members');
    for (const row of members.body.data) expect(row.organizationId).toBe(orgA);
    expect(members.body.data.some((m: Member) => m.user.email === userB.email)).toBe(false);
  });

  it('/auth/me with a forged or malformed header simply yields no active organization', async () => {
    for (const header of [orgB, 'not-a-uuid', '\'; DROP TABLE "User"; --']) {
      const res = await as(ctx, userA, header).get('/api/v1/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.data.activeOrganization).toBeNull();
      expect(res.body.data.permissions).toEqual([]);
    }
    const malformed = await as(ctx, userA, 'not-a-uuid').get('/api/v1/members');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe(ErrorCode.ORGANIZATION_REQUIRED);
  });
});
