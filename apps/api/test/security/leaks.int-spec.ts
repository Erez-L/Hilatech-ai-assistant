import { type Role } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  anon,
  as,
  createOrganization,
  createTestApp,
  lastEmailToken,
  login,
  refreshCookieFrom,
  refreshCookieHeaders,
  register,
  resetDatabase,
  uniqueEmail,
} from '../setup/test-app';

const FORBIDDEN_KEYS = [
  'passwordHash',
  'tokenHash',
  'password',
  'refreshToken',
  'invitationToken',
  'secret',
  'JWT_ACCESS_SECRET',
];

function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

describe('Security: no secrets leak in response bodies', () => {
  let ctx: TestContext;
  let owner: Actor;
  let orgId: string;
  const secrets: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx);
    secrets.push(owner.refreshCookie.split('=')[1]!, owner.password);
    orgId = (await createOrganization(ctx, owner, 'Leak Co')).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  function assertClean(body: unknown) {
    const text = JSON.stringify(body);
    for (const secret of secrets) expect(text).not.toContain(secret);
    const keys = collectKeys(body);
    for (const key of FORBIDDEN_KEYS) expect(keys.has(key)).toBe(false);
    // SHA-256 hex digests and argon2 hashes must never appear
    expect(text).not.toMatch(/\$argon2/);
    expect(text).not.toMatch(/\b[a-f0-9]{64}\b/);
  }

  it('auth responses expose only the access token, never password hashes or refresh tokens', async () => {
    const reg = await anon(ctx)
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: 'Str0ngPassword!', firstName: 'L', lastName: 'K' });
    expect(reg.status).toBe(201);
    secrets.push(refreshCookieFrom(reg).split('=')[1]!);
    assertClean(reg.body);

    const session = await login(ctx, owner.email);
    secrets.push(session.refreshCookie.split('=')[1]!);
    const me = await as(ctx, session).get('/api/v1/auth/me');
    assertClean(me.body);
    const sessions = await as(ctx, session).get('/api/v1/auth/sessions');
    assertClean(sessions.body);
    const user = await as(ctx, session).get('/api/v1/users/me');
    assertClean(user.body);
  });

  it('organization, member, role, invitation and audit payloads are clean (including the invitation token)', async () => {
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    const inviteeEmail = uniqueEmail('leak-invitee');
    const invite = await as(ctx, owner, orgId)
      .post('/api/v1/invitations')
      .send({ email: inviteeEmail, roleId: roles.find((r) => r.key === 'member')!.id });
    expect(invite.status).toBe(201);
    const token = await lastEmailToken(ctx, inviteeEmail, 'invitation');
    secrets.push(token);

    assertClean(invite.body);
    for (const url of [
      '/api/v1/organizations',
      '/api/v1/organizations/current',
      '/api/v1/organizations/current/settings',
      '/api/v1/members',
      '/api/v1/roles',
      '/api/v1/permissions',
      '/api/v1/invitations',
      '/api/v1/audit-logs?pageSize=100',
      '/api/v1/billing/subscription',
      '/api/v1/billing/usage',
      '/api/v1/analytics/dashboard',
    ]) {
      const res = await as(ctx, owner, orgId).get(url);
      expect(res.status).toBe(200);
      assertClean(res.body);
    }
    const preview = await anon(ctx).get(
      `/api/v1/invitations/preview?token=${encodeURIComponent(token)}`,
    );
    assertClean(preview.body);
  });

  it('error envelopes never echo credentials or internals', async () => {
    const badLogin = await anon(ctx)
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: 'WrongPassw0rd!' });
    expect(badLogin.status).toBe(401);
    expect(JSON.stringify(badLogin.body)).not.toContain('WrongPassw0rd!');

    const validation = await anon(ctx)
      .post('/api/v1/auth/register')
      .send({ email: 'x', password: 'Secr3tValue!!', firstName: 'a', lastName: 'b' });
    expect(validation.status).toBe(400);
    expect(JSON.stringify(validation.body)).not.toContain('Secr3tValue!!');

    const notFound = await as(ctx, owner).get('/api/v1/missing');
    expect(JSON.stringify(notFound.body)).not.toMatch(/node_modules|\.ts:|\.js:/);
  });

  it('security headers are present and the refresh cookie is the only cookie', async () => {
    const res = await anon(ctx)
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeDefined();
    const cookies = refreshCookieHeaders(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^hta_refresh=.*HttpOnly/);
  });
});
