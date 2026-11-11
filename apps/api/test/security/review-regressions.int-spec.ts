import { ErrorCode, Permission, type Role } from '@hilatech/contracts';
import request from 'supertest';

import {
  type Actor,
  type TestContext,
  anon,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from '../setup/test-app';

/**
 * Regression tests for the independent security review (docs/security/security-review.md).
 * One `describe` per finding; the finding id is in the title.
 */
describe('Security review regressions', () => {
  let ctx: TestContext;
  let owner: Actor;
  let orgId: string;
  let roles: Record<string, Role>;

  const addMember = async (actor: Actor, roleId: string) =>
    ctx.prisma.client.organizationMember.create({
      data: { organizationId: orgId, userId: actor.user.id, roleId },
    });

  const customRole = async (key: string, permissions: string[]): Promise<Role> => {
    const res = await as(ctx, owner, orgId)
      .post('/api/v1/roles')
      .send({ key, name: key, permissions });
    expect(res.status).toBe(201);
    return res.body.data as Role;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx);
    orgId = (await createOrganization(ctx, owner, 'Review Co')).id;
    roles = Object.fromEntries(
      ((await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[]).map((r) => [
        r.key,
        r,
      ]),
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  // -------------------------------------------------------------------------------------------
  describe('SEC-02: delegated administration cannot escalate privileges', () => {
    let manager: Actor;
    let admin: Actor;
    let managerRole: Role;

    beforeAll(async () => {
      manager = await register(ctx);
      admin = await register(ctx);
      managerRole = await customRole('people-manager', [
        Permission.ORG_READ,
        Permission.ROLES_READ,
        Permission.ROLES_MANAGE,
        Permission.MEMBERS_READ,
        Permission.MEMBERS_UPDATE,
        Permission.MEMBERS_REMOVE,
        Permission.MEMBERS_INVITE,
      ]);
      await addMember(manager, managerRole.id);
      await addMember(admin, roles.admin!.id);
    });

    it('a role manager cannot create a role holding permissions they do not have', async () => {
      const res = await as(ctx, manager, orgId)
        .post('/api/v1/roles')
        .send({ key: 'sneaky', name: 'sneaky', permissions: [Permission.ORG_BILLING_MANAGE] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
      expect(res.body.error.details.permissions).toContain(Permission.ORG_BILLING_MANAGE);
    });

    let readerRoleId: string;
    it('…but can create a role that stays within their own permissions', async () => {
      const res = await as(ctx, manager, orgId)
        .post('/api/v1/roles')
        .send({ key: 'reader', name: 'reader', permissions: [Permission.ORG_READ] });
      expect(res.status).toBe(201);
      readerRoleId = res.body.data.id;
    });

    it('cannot widen their own role, nor edit a role more powerful than theirs', async () => {
      const widen = await as(ctx, manager, orgId)
        .patch(`/api/v1/roles/${managerRole.id}`)
        .send({ permissions: [...managerRole.permissions, Permission.ORG_BILLING_MANAGE] });
      expect(widen.status).toBe(403);
      const adminRole = await as(ctx, manager, orgId)
        .patch(`/api/v1/roles/${roles.admin!.id}`)
        .send({ permissions: [Permission.ORG_READ] });
      expect(adminRole.status).toBe(403);
    });

    it('an admin cannot grant themselves ORG_DELETE by editing the admin role', async () => {
      const res = await as(ctx, admin, orgId)
        .patch(`/api/v1/roles/${roles.admin!.id}`)
        .send({ permissions: Object.values(Permission) });
      expect(res.status).toBe(403);
      const role = await ctx.prisma.client.role.findUniqueOrThrow({
        where: { id: roles.admin!.id },
      });
      expect(role.permissions).not.toContain(Permission.ORG_DELETE);
    });

    it('cannot assign a more powerful role to themselves or others, nor invite into one', async () => {
      const self = await ctx.prisma.client.organizationMember.findFirstOrThrow({
        where: { organizationId: orgId, userId: manager.user.id },
      });
      const promote = await as(ctx, manager, orgId)
        .patch(`/api/v1/members/${self.id}`)
        .send({ roleId: roles.admin!.id });
      expect(promote.status).toBe(403);
      const invite = await as(ctx, manager, orgId)
        .post('/api/v1/invitations')
        .send({ email: 'new-hire@test.local', roleId: roles.admin!.id });
      expect(invite.status).toBe(403);
      const ok = await as(ctx, manager, orgId)
        .post('/api/v1/invitations')
        .send({ email: 'new-hire@test.local', roleId: readerRoleId });
      // not an escalation: allowed (201) unless the plan's seat limit is reached (402)
      expect([201, 402]).toContain(ok.status);
    });

    it('cannot demote, suspend or remove a member whose role outranks theirs', async () => {
      const target = await ctx.prisma.client.organizationMember.findFirstOrThrow({
        where: { organizationId: orgId, userId: admin.user.id },
      });
      const demote = await as(ctx, manager, orgId)
        .patch(`/api/v1/members/${target.id}`)
        .send({ roleId: roles.member!.id });
      expect(demote.status).toBe(403);
      const suspend = await as(ctx, manager, orgId)
        .patch(`/api/v1/members/${target.id}`)
        .send({ status: 'suspended' });
      expect(suspend.status).toBe(403);
      const remove = await as(ctx, manager, orgId).delete(`/api/v1/members/${target.id}`);
      expect(remove.status).toBe(403);
    });

    it('owners are unrestricted (assign admin, create any role)', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/roles')
        .send({ key: 'everything', name: 'everything', permissions: Object.values(Permission) });
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('SEC-03: assistant context records require the matching read permission', () => {
    let assistantOnly: Actor;
    let leadId: string;
    let threadId: string;

    beforeAll(async () => {
      assistantOnly = await register(ctx);
      const role = await customRole('assistant-only', [
        Permission.ORG_READ,
        Permission.AI_ASSISTANT_USE,
      ]);
      await addMember(assistantOnly, role.id);
      const provider = await as(ctx, owner, orgId)
        .post('/api/v1/ai/providers')
        .send({ provider: 'mock', name: 'review mock', defaultModel: 'mock-chat' });
      expect(provider.status).toBe(201);
      const lead = await as(ctx, owner, orgId)
        .post('/api/v1/leads')
        .send({ title: 'Confidential deal', value: 1000 });
      expect(lead.status).toBe(201);
      leadId = lead.body.data.id;
      const thread = await as(ctx, assistantOnly, orgId).post('/api/v1/assistant/threads').send({});
      expect(thread.status).toBe(201);
      threadId = thread.body.data.id;
    });

    it('rejects lead / contact / conversation context for a user without the read permission', async () => {
      const a = as(ctx, assistantOnly, orgId);
      for (const context of [
        { leadId },
        { contactId: '11111111-1111-4111-8111-111111111111' },
        { conversationId: '22222222-2222-4222-8222-222222222222' },
      ]) {
        const res = await a
          .post(`/api/v1/assistant/threads/${threadId}/messages`)
          .send({ content: 'summarise', context });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
      }
    });

    it('still allows the owner (who holds LEADS_READ) to attach the lead', async () => {
      const ownerThread = await as(ctx, owner, orgId).post('/api/v1/assistant/threads').send({});
      const res = await as(ctx, owner, orgId)
        .post(`/api/v1/assistant/threads/${ownerThread.body.data.id}/messages`)
        .send({ content: 'summarise', context: { leadId } });
      expect(res.status).toBeLessThan(300);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('SEC-01: AI provider endpoints are SSRF-guarded', () => {
    it.each([
      'http://169.254.169.254/latest/meta-data',
      'http://169.254.170.2/v2/credentials',
      'https://10.0.0.5/v1',
      'https://192.168.1.10/v1',
      'https://[::ffff:169.254.169.254]/v1',
      'ftp://example.com/v1',
    ])('refuses baseUrl %s at creation time', async (baseUrl) => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/ai/providers')
        .send({
          provider: 'openai',
          name: `ssrf-${Math.random()}`,
          apiKey: 'sk-test-0123456789',
          baseUrl,
          defaultModel: 'gpt-4o-mini',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('also blocks a stored endpoint at use time (rows written before the guard / directly in the DB)', async () => {
      const created = await as(ctx, owner, orgId).post('/api/v1/ai/providers').send({
        provider: 'openai',
        name: 'legacy-ssrf',
        apiKey: 'sk-test-0123456789',
        baseUrl: 'http://localhost:9/v1', // loopback is only allowed outside production
        defaultModel: 'gpt-4o-mini',
      });
      expect(created.status).toBe(201);
      await ctx.prisma.client.aiProviderConfig.update({
        where: { id: created.body.data.id },
        data: { baseUrl: 'http://169.254.169.254/latest' },
      });
      const health = await as(ctx, owner, orgId).post(
        `/api/v1/ai/providers/${created.body.data.id}/health`,
      );
      expect(health.status).toBe(200);
      expect(health.body.data.status).toBe('error');
      expect(health.body.data.error).toMatch(/outbound policy/i);
    });

    it('never honours a stored endpoint override for Bedrock', async () => {
      const res = await as(ctx, owner, orgId).post('/api/v1/ai/providers').send({
        provider: 'bedrock',
        name: 'bedrock-x',
        baseUrl: 'https://10.0.0.5',
        region: 'us-east-1',
        defaultModel: 'anthropic.claude-3-haiku-20240307-v1:0',
      });
      // 400 when Bedrock is disabled on the server, otherwise created with baseUrl discarded
      if (res.status === 201) expect(res.body.data.baseUrl).toBeNull();
      else expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('SEC-04: access tokens die with their session', () => {
    it('logout revokes the access token immediately', async () => {
      const user = await register(ctx);
      expect((await as(ctx, user).get('/api/v1/users/me')).status).toBe(200);
      const out = await request(ctx.http)
        .post('/api/v1/auth/logout')
        .set('Cookie', user.refreshCookie);
      expect(out.status).toBe(204);
      const after = await as(ctx, user).get('/api/v1/users/me');
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
    });

    it('revoking a session via DELETE /auth/sessions/:id kills that session’s access token only', async () => {
      const user = await register(ctx);
      const second = await request(ctx.http)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password });
      const secondToken = second.body.data.accessToken as string;
      const sessions = await as(ctx, user).get('/api/v1/auth/sessions');
      const other = (sessions.body.data as Array<{ familyId: string; current: boolean }>).find(
        (s) => !s.current,
      )!;
      expect((await as(ctx, user).delete(`/api/v1/auth/sessions/${other.familyId}`)).status).toBe(
        204,
      );
      expect((await as(ctx, user).get('/api/v1/users/me')).status).toBe(200);
      expect((await as(ctx, { accessToken: secondToken }).get('/api/v1/users/me')).status).toBe(
        401,
      );
    });

    it('password change revokes every other session’s access token', async () => {
      const user = await register(ctx);
      const other = await request(ctx.http)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password });
      const otherToken = other.body.data.accessToken as string;
      const change = await as(ctx, user)
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: user.password, newPassword: 'An0therStrongPassw0rd!' });
      expect(change.status).toBe(204);
      expect((await as(ctx, { accessToken: otherToken }).get('/api/v1/users/me')).status).toBe(401);
      expect((await as(ctx, user).get('/api/v1/users/me')).status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('SEC-05: notification links cannot leave the application origin', () => {
    it('drops protocol-relative and backslash links before persisting', async () => {
      const { NotificationsService } =
        await import('../../src/modules/notifications/notifications.service');
      const notifications = ctx.app.get(NotificationsService);
      const link = async (value: string) => {
        const n = await notifications.notify({
          organizationId: orgId,
          userId: owner.user.id,
          type: 'system',
          title: 'x',
          link: value,
        });
        return n?.link ?? null;
      };
      expect(await link('/leads/123')).toBe('/leads/123');
      expect(await link('//evil.example/x')).toBeNull();
      expect(await link('/\\evil.example/x')).toBeNull();
      expect(await link('https://evil.example/x')).toBeNull();
    });
  });

  it('anonymous callers still get 401 on a tenant route (sanity)', async () => {
    expect((await anon(ctx).get('/api/v1/members')).status).toBe(401);
  });
});
