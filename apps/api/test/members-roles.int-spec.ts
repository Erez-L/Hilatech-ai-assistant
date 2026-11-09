import {
  ALL_PERMISSIONS,
  AuditAction,
  ErrorCode,
  type Member,
  Permission,
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

/** Directly attach a user to an organization (test fixture; the invitation flow is covered elsewhere). */
async function addMember(ctx: TestContext, orgId: string, userId: string, roleId: string) {
  return ctx.prisma.client.organizationMember.create({
    data: { organizationId: orgId, userId, roleId, status: 'active' },
  });
}

describe('Members & roles', () => {
  let ctx: TestContext;
  let owner: Actor;
  let admin: Actor;
  let member: Actor;
  let orgId: string;
  let roles: Record<string, Role>;
  let members: Record<string, Member>;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    admin = await register(ctx, { firstName: 'Ada', lastName: 'Admin' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    const org = await createOrganization(ctx, owner, 'Team Co');
    orgId = org.id;
    const list = await as(ctx, owner, orgId).get('/api/v1/roles');
    roles = Object.fromEntries((list.body.data as Role[]).map((r) => [r.key, r]));
    await addMember(ctx, orgId, admin.user.id, roles.admin!.id);
    await addMember(ctx, orgId, member.user.id, roles.member!.id);
    const res = await as(ctx, owner, orgId).get('/api/v1/members?pageSize=50');
    members = Object.fromEntries((res.body.data as Member[]).map((m) => [m.user.email, m]));
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('members', () => {
    it('lists members with role and user summary, paginated', async () => {
      const res = await as(ctx, member, orgId).get('/api/v1/members?page=1&pageSize=2');
      expect(res.status).toBe(200);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
      expect(res.body.data[0]).toMatchObject({
        organizationId: orgId,
        status: 'active',
        role: { key: 'owner' },
        user: { email: owner.email },
      });
      expectNoSensitiveLeak(res.body);
    });

    it('an admin cannot assign the owner role, change an owner, or remove an owner', async () => {
      const promote = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${members[member.email]!.id}`)
        .send({ roleId: roles.owner!.id });
      expect(promote.status).toBe(403);
      expect(promote.body.error.code).toBe(ErrorCode.FORBIDDEN);

      const demoteOwner = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${members[owner.email]!.id}`)
        .send({ roleId: roles.member!.id });
      expect(demoteOwner.status).toBe(403);

      const suspendOwner = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${members[owner.email]!.id}`)
        .send({ status: 'suspended' });
      expect(suspendOwner.status).toBe(403);

      const removeOwner = await as(ctx, admin, orgId).delete(
        `/api/v1/members/${members[owner.email]!.id}`,
      );
      expect(removeOwner.status).toBe(403);
    });

    it('the last owner cannot be demoted, suspended, removed or leave', async () => {
      const ownerMember = members[owner.email]!;
      const demote = await as(ctx, owner, orgId)
        .patch(`/api/v1/members/${ownerMember.id}`)
        .send({ roleId: roles.admin!.id });
      expect(demote.status).toBe(409);
      expect(demote.body.error.code).toBe(ErrorCode.CONFLICT);

      const leave = await as(ctx, owner, orgId).delete('/api/v1/members/me');
      expect(leave.status).toBe(409);

      const remove = await as(ctx, owner, orgId).delete(`/api/v1/members/${ownerMember.id}`);
      expect(remove.status).toBe(403); // self-removal must go through /members/me
    });

    it('an admin can change a member role and suspend/reactivate them (audited)', async () => {
      const target = members[member.email]!;
      const custom = await as(ctx, owner, orgId)
        .post('/api/v1/roles')
        .send({ key: 'sales', name: 'Sales', permissions: [Permission.LEADS_READ] });
      expect(custom.status).toBe(201);

      const change = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${target.id}`)
        .send({ roleId: custom.body.data.id });
      expect(change.status).toBe(200);
      expect(change.body.data.role.key).toBe('sales');

      const suspend = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${target.id}`)
        .send({ status: 'suspended' });
      expect(suspend.status).toBe(200);
      expect(suspend.body.data.status).toBe('suspended');

      // suspended members are not members for tenant resolution
      const denied = await as(ctx, member, orgId).get('/api/v1/organizations/current');
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);

      const reactivate = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${target.id}`)
        .send({ status: 'active', roleId: roles.member!.id });
      expect(reactivate.status).toBe(200);
      expect((await as(ctx, member, orgId).get('/api/v1/organizations/current')).status).toBe(200);

      const audits = await ctx.prisma.client.auditLog.count({
        where: { action: AuditAction.MEMBER_UPDATED, organizationId: orgId, targetId: target.id },
      });
      expect(audits).toBe(3);

      const selfSuspend = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${members[admin.email]!.id}`)
        .send({ status: 'suspended' });
      expect(selfSuspend.status).toBe(403);

      const unknownRole = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${target.id}`)
        .send({ roleId: '00000000-0000-4000-8000-000000000000' });
      expect(unknownRole.status).toBe(400);
    });

    it('ownership can be shared and then the original owner demoted; a member can leave', async () => {
      const promote = await as(ctx, owner, orgId)
        .patch(`/api/v1/members/${members[admin.email]!.id}`)
        .send({ roleId: roles.owner!.id });
      expect(promote.status).toBe(200);
      expect(promote.body.data.role.key).toBe('owner');

      const demote = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${members[owner.email]!.id}`)
        .send({ roleId: roles.admin!.id });
      expect(demote.status).toBe(200);
      expect(demote.body.data.role.key).toBe('admin');

      // restore for the following tests
      const restore = await as(ctx, admin, orgId)
        .patch(`/api/v1/members/${members[owner.email]!.id}`)
        .send({ roleId: roles.owner!.id });
      expect(restore.status).toBe(200);
      const downgradeAdmin = await as(ctx, owner, orgId)
        .patch(`/api/v1/members/${members[admin.email]!.id}`)
        .send({ roleId: roles.admin!.id });
      expect(downgradeAdmin.status).toBe(200);

      const leaver = await register(ctx, { firstName: 'Lee', lastName: 'Leaver' });
      await addMember(ctx, orgId, leaver.user.id, roles.member!.id);
      const leave = await as(ctx, leaver, orgId).delete('/api/v1/members/me');
      expect(leave.status).toBe(204);
      expect((await as(ctx, leaver, orgId).get('/api/v1/organizations/current')).status).toBe(403);
      const removed = await ctx.prisma.client.auditLog.findFirst({
        where: {
          action: AuditAction.MEMBER_REMOVED,
          organizationId: orgId,
          actorUserId: leaver.user.id,
        },
      });
      expect(removed?.metadata).toMatchObject({ left: true });
    });

    it('owner removes a member; unknown member ids are 404', async () => {
      const victim = await register(ctx, { firstName: 'Vic', lastName: 'Tim' });
      const row = await addMember(ctx, orgId, victim.user.id, roles.member!.id);
      const res = await as(ctx, owner, orgId).delete(`/api/v1/members/${row.id}`);
      expect(res.status).toBe(204);
      expect((await as(ctx, owner, orgId).delete(`/api/v1/members/${row.id}`)).status).toBe(404);
      expect((await as(ctx, owner, orgId).delete('/api/v1/members/not-a-uuid')).status).toBe(400);
    });
  });

  describe('roles', () => {
    it('GET /permissions returns the catalog matching the contracts vocabulary', async () => {
      const res = await as(ctx, member, orgId).get('/api/v1/permissions');
      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { key: string }) => p.key).sort()).toEqual(
        [...ALL_PERMISSIONS].sort(),
      );
    });

    it('system roles cannot be renamed or deleted; owner permissions cannot be reduced; other system roles can change', async () => {
      const rename = await as(ctx, owner, orgId)
        .patch(`/api/v1/roles/${roles.admin!.id}`)
        .send({ name: 'Superadmin' });
      expect(rename.status).toBe(403);

      const reduce = await as(ctx, owner, orgId)
        .patch(`/api/v1/roles/${roles.owner!.id}`)
        .send({ permissions: [Permission.ORG_READ] });
      expect(reduce.status).toBe(403);
      expect(reduce.body.error.code).toBe(ErrorCode.FORBIDDEN);

      const del = await as(ctx, owner, orgId).delete(`/api/v1/roles/${roles.member!.id}`);
      expect(del.status).toBe(403);

      const adjust = await as(ctx, owner, orgId)
        .patch(`/api/v1/roles/${roles.member!.id}`)
        .send({
          description: 'Regular staff',
          permissions: [Permission.ORG_READ, Permission.MEMBERS_READ, Permission.ROLES_READ],
        });
      expect(adjust.status).toBe(200);
      expect(adjust.body.data.permissions).toEqual([
        Permission.ORG_READ,
        Permission.MEMBERS_READ,
        Permission.ROLES_READ,
      ]);

      // the member user immediately loses analytics access (permissions come from the role at request time)
      const analytics = await as(ctx, member, orgId).get('/api/v1/analytics/dashboard');
      expect(analytics.status).toBe(403);
    });

    it('custom roles validate keys and permissions; roles with members cannot be deleted', async () => {
      const reserved = await as(ctx, owner, orgId)
        .post('/api/v1/roles')
        .send({ key: 'owner', name: 'Fake owner', permissions: [] });
      expect(reserved.status).toBe(409);

      const unknown = await as(ctx, owner, orgId)
        .post('/api/v1/roles')
        .send({ key: 'ops', name: 'Ops', permissions: ['leads:fly'] });
      expect(unknown.status).toBe(400);
      expect(JSON.stringify(unknown.body.error.details)).toContain('leads:fly');

      const duplicate = await as(ctx, owner, orgId)
        .post('/api/v1/roles')
        .send({ key: 'sales', name: 'Sales 2', permissions: [] });
      expect(duplicate.status).toBe(409);

      const sales = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data.find(
        (r: Role) => r.key === 'sales',
      ) as Role;
      const target = members[member.email]!;
      await as(ctx, owner, orgId).patch(`/api/v1/members/${target.id}`).send({ roleId: sales.id });
      const inUse = await as(ctx, owner, orgId).delete(`/api/v1/roles/${sales.id}`);
      expect(inUse.status).toBe(409);

      await as(ctx, owner, orgId)
        .patch(`/api/v1/members/${target.id}`)
        .send({ roleId: roles.member!.id });
      const deleted = await as(ctx, owner, orgId).delete(`/api/v1/roles/${sales.id}`);
      expect(deleted.status).toBe(204);
      expect((await as(ctx, owner, orgId).get(`/api/v1/roles/${sales.id}`)).status).toBe(404);

      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { action: AuditAction.ROLE_DELETED, targetId: sales.id },
      });
      expect(audit).not.toBeNull();
    });

    it('members with ROLES_READ can list roles but not manage them', async () => {
      const list = await as(ctx, member, orgId).get('/api/v1/roles');
      expect(list.status).toBe(200);
      const create = await as(ctx, member, orgId)
        .post('/api/v1/roles')
        .send({ key: 'x1', name: 'X', permissions: [] });
      expect(create.status).toBe(403);
    });
  });
});
