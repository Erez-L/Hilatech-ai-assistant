import { AuditAction, ErrorCode, type Role, QueueName } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  anon,
  as,
  createOrganization,
  createTestApp,
  expectNoSensitiveLeak,
  jobsOn,
  lastEmailToken,
  register,
  resetDatabase,
  uniqueEmail,
  PASSWORD,
} from './setup/test-app';

describe('Invitations', () => {
  let ctx: TestContext;
  let owner: Actor;
  let orgId: string;
  let roles: Record<string, Role>;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Ivy', lastName: 'Inviter' });
    const org = await createOrganization(ctx, owner, 'Invite Co');
    orgId = org.id;
    const list = await as(ctx, owner, orgId).get('/api/v1/roles');
    roles = Object.fromEntries((list.body.data as Role[]).map((r) => [r.key, r]));
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('invite → register with token', () => {
    const inviteeEmail = uniqueEmail('invitee');
    let invitationId: string;
    let token: string;

    it('POST /invitations stores a hash, returns the invitation without the token and queues the email', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/invitations')
        .send({ email: inviteeEmail.toUpperCase(), roleId: roles.member!.id });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        email: inviteeEmail,
        status: 'pending',
        role: { key: 'member' },
        invitedBy: { id: owner.user.id },
      });
      expect(res.body.data.token).toBeUndefined();
      expect(res.body.data.tokenHash).toBeUndefined();
      invitationId = res.body.data.id;

      token = await lastEmailToken(ctx, inviteeEmail, 'invitation');
      expect(JSON.stringify(res.body)).not.toContain(token);
      const jobs = await jobsOn(ctx, QueueName.EMAIL);
      const job = jobs.find((j) => j.data.to === inviteeEmail);
      expect(job?.id).toBe(`invite-${invitationId}`);
      expect(job?.data.variables).toMatchObject({
        organizationName: 'Invite Co',
        roleName: 'Member',
        inviterName: 'Ivy Inviter',
      });

      const row = await ctx.prisma.client.invitation.findUnique({ where: { id: invitationId } });
      expect(row?.tokenHash).not.toBe(token);
      expect(row?.tokenHash).toHaveLength(64);

      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { action: AuditAction.MEMBER_INVITED, organizationId: orgId },
      });
      expect(audit?.targetId).toBe(invitationId);
    });

    it('a second pending invitation for the same email is rejected with 409', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/invitations')
        .send({ email: inviteeEmail, roleId: roles.member!.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCode.CONFLICT);
    });

    it('GET /invitations/preview is public and returns the invitee-facing view', async () => {
      const res = await anon(ctx).get(
        `/api/v1/invitations/preview?token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        email: inviteeEmail,
        organizationName: 'Invite Co',
        roleName: 'Member',
        status: 'pending',
      });
      expectNoSensitiveLeak(res.body);

      const unknown = await anon(ctx).get(`/api/v1/invitations/preview?token=${'z'.repeat(64)}`);
      expect(unknown.status).toBe(404);
    });

    it('registering with a different email than the invitee is refused', async () => {
      const res = await anon(ctx)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail('impostor'),
          password: PASSWORD,
          firstName: 'Im',
          lastName: 'Postor',
          invitationToken: token,
        });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
      expect(
        await ctx.prisma.client.user.count({ where: { email: { contains: 'impostor' } } }),
      ).toBe(0);
    });

    it('registering with the invitation token joins the organization with the invited role', async () => {
      const invitee = await register(ctx, {
        email: inviteeEmail,
        firstName: 'Ira',
        lastName: 'Invitee',
        invitationToken: token,
      });
      expect(invitee.organizations).toEqual([
        expect.objectContaining({ id: orgId, roleKey: 'member', roleName: 'Member' }),
      ]);

      const row = await ctx.prisma.client.invitation.findUnique({ where: { id: invitationId } });
      expect(row?.status).toBe('accepted');
      expect(row?.acceptedAt).not.toBeNull();

      const joined = await ctx.prisma.client.auditLog.findFirst({
        where: {
          action: AuditAction.MEMBER_JOINED,
          organizationId: orgId,
          actorUserId: invitee.user.id,
        },
      });
      expect(joined).not.toBeNull();

      const notifications = await jobsOn(ctx, QueueName.NOTIFICATIONS);
      const notif = notifications.find((j) => j.id === `notif-member-joined-${invitationId}`);
      expect(notif?.data).toMatchObject({
        userId: owner.user.id,
        type: 'member_joined',
        organizationId: orgId,
      });

      // the token is burnt
      const reuse = await anon(ctx)
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${invitee.accessToken}`)
        .send({ token });
      expect(reuse.status).toBe(400);
      expect(reuse.body.error.code).toBe(ErrorCode.TOKEN_INVALID);

      // the member can read the org but cannot invite
      const me = await as(ctx, invitee, orgId).get('/api/v1/organizations/current');
      expect(me.status).toBe(200);
      const invite = await as(ctx, invitee, orgId)
        .post('/api/v1/invitations')
        .send({ email: uniqueEmail(), roleId: roles.member!.id });
      expect(invite.status).toBe(403);
      expect(invite.body.error.code).toBe(ErrorCode.FORBIDDEN);
    });

    it('GET /invitations lists invitations with pagination meta', async () => {
      const res = await as(ctx, owner, orgId).get('/api/v1/invitations?pageSize=10');
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0]).toMatchObject({ id: invitationId, status: 'accepted' });
      expectNoSensitiveLeak(res.body, [token]);
    });
  });

  describe('invite → accept while logged in, revoke, entitlements', () => {
    it('an existing user accepts via POST /invitations/accept only with the matching email', async () => {
      const existing = await register(ctx, { firstName: 'Eve', lastName: 'Existing' });
      const stranger = await register(ctx, { firstName: 'Sam', lastName: 'Stranger' });

      // upgrade the plan so the seat limit does not interfere in this test
      await ctx.prisma.client.subscription.update({
        where: { organizationId: orgId },
        data: {
          limits: {
            seats: 10,
            aiTokensPerMonth: 1,
            agents: 1,
            knowledgeDocuments: 1,
            storageMb: 1,
            automations: 1,
          },
        },
      });

      const invite = await as(ctx, owner, orgId)
        .post('/api/v1/invitations')
        .send({ email: existing.email, roleId: roles.admin!.id });
      expect(invite.status).toBe(201);
      const token = await lastEmailToken(ctx, existing.email, 'invitation');

      const wrongUser = await as(ctx, stranger).post('/api/v1/invitations/accept').send({ token });
      expect(wrongUser.status).toBe(403);

      const accept = await as(ctx, existing).post('/api/v1/invitations/accept').send({ token });
      expect(accept.status).toBe(200);
      expect(accept.body.data).toMatchObject({ id: orgId, roleKey: 'admin' });

      const member = await as(ctx, existing, orgId).get('/api/v1/members');
      expect(member.status).toBe(200);
      expect(member.body.data.some((m: { userId: string }) => m.userId === existing.user.id)).toBe(
        true,
      );
    });

    it('revoking a pending invitation makes it unusable and is audited', async () => {
      const email = uniqueEmail('revoked');
      const invite = await as(ctx, owner, orgId)
        .post('/api/v1/invitations')
        .send({ email, roleId: roles.member!.id });
      expect(invite.status).toBe(201);
      const token = await lastEmailToken(ctx, email, 'invitation');

      const revoke = await as(ctx, owner, orgId).delete(
        `/api/v1/invitations/${invite.body.data.id}`,
      );
      expect(revoke.status).toBe(204);
      const again = await as(ctx, owner, orgId).delete(
        `/api/v1/invitations/${invite.body.data.id}`,
      );
      expect(again.status).toBe(409);

      const preview = await anon(ctx).get(
        `/api/v1/invitations/preview?token=${encodeURIComponent(token)}`,
      );
      expect(preview.body.data.status).toBe('revoked');

      const user = await register(ctx, { email });
      const accept = await as(ctx, user).post('/api/v1/invitations/accept').send({ token });
      expect(accept.status).toBe(400);
      expect(accept.body.error.code).toBe(ErrorCode.TOKEN_INVALID);

      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { action: AuditAction.INVITATION_REVOKED, targetId: invite.body.data.id },
      });
      expect(audit).not.toBeNull();
    });

    it('rejects role ids from another organization and owner invitations by non-owners', async () => {
      const other = await register(ctx);
      const otherOrg = await createOrganization(ctx, other, 'Elsewhere');
      const otherRoles = await as(ctx, other, otherOrg.id).get('/api/v1/roles');
      const foreignRole = (otherRoles.body.data as Role[]).find((r) => r.key === 'member')!;

      const res = await as(ctx, owner, orgId)
        .post('/api/v1/invitations')
        .send({ email: uniqueEmail(), roleId: foreignRole.id });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('seat entitlement: inviting beyond the plan seats returns 402 ENTITLEMENT_EXCEEDED', async () => {
      // active members: owner + member + admin = 3 → set the limit to exactly that
      await ctx.prisma.client.subscription.update({
        where: { organizationId: orgId },
        data: {
          limits: {
            seats: 3,
            aiTokensPerMonth: 1,
            agents: 1,
            knowledgeDocuments: 1,
            storageMb: 1,
            automations: 1,
          },
        },
      });
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/invitations')
        .send({ email: uniqueEmail('over'), roleId: roles.member!.id });
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe(ErrorCode.ENTITLEMENT_EXCEEDED);
      expect(res.body.error.details).toMatchObject({ metric: 'seats', used: 3, limit: 3 });
    });
  });
});
