import { AuditAction, ErrorCode, REFRESH_COOKIE_NAME } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  anon,
  as,
  createTestApp,
  emailJobsTo,
  expectNoSensitiveLeak,
  lastEmailToken,
  login,
  refreshCookieFrom,
  refreshCookieHeaders,
  register,
  resetDatabase,
  uniqueEmail,
  PASSWORD,
} from './setup/test-app';
import { RedisService } from '../src/infrastructure/redis/redis.service';

describe('Auth journey', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /health and /health/ready report the dependencies', async () => {
    const live = await anon(ctx).get('/api/v1/health');
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('ok');
    expect(live.headers['x-request-id']).toBeDefined();

    const ready = await anon(ctx).get('/api/v1/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.details).toEqual({ database: { status: 'up' }, redis: { status: 'up' } });
  });

  describe('register → me → refresh → logout → refresh fails', () => {
    let actor: Actor;

    it('registers a user without an organization, sets the refresh cookie and queues a verification email', async () => {
      const email = uniqueEmail('journey');
      const res = await anon(ctx)
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, firstName: 'Jo', lastName: 'Journey' });
      expect(res.status).toBe(201);
      expect(res.body.data.tokenType).toBe('Bearer');
      expect(res.body.data.expiresIn).toBeGreaterThan(0);
      expect(res.body.data.user).toMatchObject({
        email,
        firstName: 'Jo',
        lastName: 'Journey',
        emailVerifiedAt: null,
      });
      expect(res.body.data.organizations).toEqual([]);
      expectNoSensitiveLeak(res.body);

      const cookies = refreshCookieHeaders(res);
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toMatch(new RegExp(`^${REFRESH_COOKIE_NAME}=`));
      expect(cookies[0]).toContain('HttpOnly');
      expect(cookies[0]).toContain('SameSite=Lax');
      expect(cookies[0]).toContain('Path=/api/v1/auth');

      actor = {
        email,
        password: PASSWORD,
        accessToken: res.body.data.accessToken,
        refreshCookie: refreshCookieFrom(res),
        user: res.body.data.user,
        organizations: [],
      };

      const jobs = await emailJobsTo(ctx, email, 'verify_email');
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.id).not.toContain(':');
      expect(typeof (jobs[0]!.data.variables as { token: string }).token).toBe('string');

      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { action: AuditAction.AUTH_REGISTER, actorUserId: actor.user.id },
      });
      expect(audit).not.toBeNull();
    });

    it('GET /auth/me returns the session without an active organization', async () => {
      const res = await as(ctx, actor).get('/api/v1/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(actor.email);
      expect(res.body.data.organizations).toEqual([]);
      expect(res.body.data.activeOrganization).toBeNull();
      expect(res.body.data.permissions).toEqual([]);
      expectNoSensitiveLeak(res.body);
    });

    let rotatedCookie: string;

    it('POST /auth/refresh rotates the refresh token and issues a new access token', async () => {
      const res = await anon(ctx).post('/api/v1/auth/refresh').set('Cookie', actor.refreshCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      rotatedCookie = refreshCookieFrom(res);
      expect(rotatedCookie).not.toBe(actor.refreshCookie);

      const me = await anon(ctx)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.data.accessToken}`);
      expect(me.status).toBe(200);
    });

    it('re-using the previous refresh token is detected, revokes the whole family and is audited', async () => {
      const reuse = await anon(ctx).post('/api/v1/auth/refresh').set('Cookie', actor.refreshCookie);
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.code).toBe(ErrorCode.TOKEN_REUSED);
      expect(refreshCookieHeaders(reuse)[0]).toMatch(/Expires=Thu, 01 Jan 1970/);

      // The legitimately rotated token is dead too (family revoked).
      const victim = await anon(ctx).post('/api/v1/auth/refresh').set('Cookie', rotatedCookie);
      expect(victim.status).toBe(401);
      expect(victim.body.error.code).toBe(ErrorCode.TOKEN_INVALID);

      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { action: AuditAction.AUTH_REFRESH_REUSE_DETECTED, actorUserId: actor.user.id },
      });
      expect(audit).not.toBeNull();
    });

    it('login → logout clears the cookie and revokes the session; refresh then fails', async () => {
      const fresh = await login(ctx, actor.email);
      const logout = await anon(ctx).post('/api/v1/auth/logout').set('Cookie', fresh.refreshCookie);
      expect(logout.status).toBe(204);
      expect(refreshCookieHeaders(logout)[0]).toMatch(/Expires=Thu, 01 Jan 1970/);

      const refresh = await anon(ctx)
        .post('/api/v1/auth/refresh')
        .set('Cookie', fresh.refreshCookie);
      expect(refresh.status).toBe(401);
      expect(refresh.body.error.code).toBe(ErrorCode.TOKEN_INVALID);

      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { action: AuditAction.AUTH_LOGOUT, actorUserId: actor.user.id },
      });
      expect(audit).not.toBeNull();
    });

    it('refresh without a cookie → 401 TOKEN_INVALID', async () => {
      const res = await anon(ctx).post('/api/v1/auth/refresh');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
    });
  });

  describe('validation and credentials', () => {
    it('rejects weak passwords and malformed emails with zod issues', async () => {
      const res = await anon(ctx)
        .post('/api/v1/auth/register')
        .send({ email: 'nope', password: 'short', firstName: '', lastName: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      const paths = (res.body.error.details as Array<{ path: string }>).map((d) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['email', 'password', 'firstName']));
    });

    it('rejects duplicate emails (case-insensitive) with 409', async () => {
      const actor = await register(ctx);
      const res = await anon(ctx).post('/api/v1/auth/register').send({
        email: actor.email.toUpperCase(),
        password: PASSWORD,
        firstName: 'A',
        lastName: 'B',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCode.CONFLICT);
    });

    it('returns the identical error for unknown email and wrong password, and audits failures', async () => {
      const actor = await register(ctx);
      const unknown = await anon(ctx)
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('ghost'), password: PASSWORD });
      const wrong = await anon(ctx)
        .post('/api/v1/auth/login')
        .send({ email: actor.email, password: 'WrongPassw0rd!' });
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
      expect(wrong.body.error).toMatchObject({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: unknown.body.error.message,
      });
      expect(refreshCookieHeaders(wrong)).toHaveLength(0);

      const failed = await ctx.prisma.client.auditLog.count({
        where: { action: AuditAction.AUTH_LOGIN_FAILED, actorUserId: actor.user.id },
      });
      expect(failed).toBe(1);
    });
  });

  describe('email verification', () => {
    it('verifies the email with the queued token exactly once', async () => {
      const actor = await register(ctx);
      const token = await lastEmailToken(ctx, actor.email, 'verify_email');

      const ok = await anon(ctx).post('/api/v1/auth/verify-email').send({ token });
      expect(ok.status).toBe(204);
      const me = await as(ctx, actor).get('/api/v1/users/me');
      expect(me.body.data.emailVerifiedAt).not.toBeNull();

      const again = await anon(ctx).post('/api/v1/auth/verify-email').send({ token });
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe(ErrorCode.TOKEN_INVALID);

      const bogus = await anon(ctx)
        .post('/api/v1/auth/verify-email')
        .send({ token: 'x'.repeat(40) });
      expect(bogus.status).toBe(400);
      expect(bogus.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
    });
  });

  describe('password reset', () => {
    it('forgot-password always returns 202 and only emails existing accounts', async () => {
      const actor = await register(ctx);
      const ghost = uniqueEmail('ghost');

      const known = await anon(ctx)
        .post('/api/v1/auth/forgot-password')
        .send({ email: actor.email });
      const unknown = await anon(ctx).post('/api/v1/auth/forgot-password').send({ email: ghost });
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(known.body.data).toEqual(unknown.body.data);

      expect(await emailJobsTo(ctx, actor.email, 'password_reset')).toHaveLength(1);
      expect(await emailJobsTo(ctx, ghost)).toHaveLength(0);
    });

    it('reset-password sets the new password, revokes all sessions and burns the token', async () => {
      const actor = await register(ctx);
      await anon(ctx).post('/api/v1/auth/forgot-password').send({ email: actor.email });
      const token = await lastEmailToken(ctx, actor.email, 'password_reset');

      const newPassword = 'An0therStrongPass!';
      const reset = await anon(ctx)
        .post('/api/v1/auth/reset-password')
        .send({ token, password: newPassword });
      expect(reset.status).toBe(204);

      // old session revoked
      const refresh = await anon(ctx)
        .post('/api/v1/auth/refresh')
        .set('Cookie', actor.refreshCookie);
      expect(refresh.status).toBe(401);

      // old password rejected, new accepted
      expect(
        (
          await anon(ctx)
            .post('/api/v1/auth/login')
            .send({ email: actor.email, password: PASSWORD })
        ).status,
      ).toBe(401);
      expect(
        (
          await anon(ctx)
            .post('/api/v1/auth/login')
            .send({ email: actor.email, password: newPassword })
        ).status,
      ).toBe(200);

      // token single-use
      const again = await anon(ctx)
        .post('/api/v1/auth/reset-password')
        .send({ token, password: newPassword });
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
    });
  });

  describe('change-password and sessions', () => {
    it('change-password requires the current password and revokes the other sessions only', async () => {
      const actor = await register(ctx);
      const other = await login(ctx, actor.email);

      const wrong = await as(ctx, actor)
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: 'Nope12345!', newPassword: 'NewPassw0rd!!' });
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);

      const ok = await as(ctx, actor)
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: 'NewPassw0rd!!' });
      expect(ok.status).toBe(204);

      // the other session is gone, the current one survives
      expect(
        (await anon(ctx).post('/api/v1/auth/refresh').set('Cookie', other.refreshCookie)).status,
      ).toBe(401);
      expect(
        (await anon(ctx).post('/api/v1/auth/refresh').set('Cookie', actor.refreshCookie)).status,
      ).toBe(200);
    });

    it('lists active sessions and revokes one by family id', async () => {
      const actor = await register(ctx);
      const second = await login(ctx, actor.email);

      const list = await as(ctx, actor).get('/api/v1/auth/sessions');
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(2);
      const current = list.body.data.find((s: { current: boolean }) => s.current);
      const remote = list.body.data.find((s: { current: boolean }) => !s.current);
      expect(current).toBeDefined();
      expect(remote).toBeDefined();
      expectNoSensitiveLeak(list.body);

      const revoke = await as(ctx, actor).delete(`/api/v1/auth/sessions/${remote.familyId}`);
      expect(revoke.status).toBe(204);
      expect(
        (await anon(ctx).post('/api/v1/auth/refresh').set('Cookie', second.refreshCookie)).status,
      ).toBe(401);

      const after = await as(ctx, actor).get('/api/v1/auth/sessions');
      expect(after.body.data).toHaveLength(1);

      const foreign = await as(ctx, actor).delete(
        '/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000',
      );
      expect(foreign.status).toBe(404);
    });
  });

  describe('users', () => {
    it('updates the profile and preferences with validation', async () => {
      const actor = await register(ctx);
      const profile = await as(ctx, actor)
        .patch('/api/v1/users/me')
        .send({ firstName: 'Renamed', avatarUrl: 'https://cdn.example.com/a.png' });
      expect(profile.status).toBe(200);
      expect(profile.body.data).toMatchObject({
        firstName: 'Renamed',
        avatarUrl: 'https://cdn.example.com/a.png',
      });

      const bad = await as(ctx, actor)
        .patch('/api/v1/users/me')
        .send({ email: 'hacker@example.com' });
      expect(bad.status).toBe(400);

      const prefs = await as(ctx, actor)
        .put('/api/v1/users/me/preferences')
        .send({ theme: 'dark', locale: 'he', notifications: { email: { member_joined: false } } });
      expect(prefs.status).toBe(200);
      expect(prefs.body.data).toEqual({
        theme: 'dark',
        locale: 'he',
        notifications: { email: { member_joined: false } },
      });

      const read = await as(ctx, actor).get('/api/v1/users/me/preferences');
      expect(read.body.data.theme).toBe('dark');

      const invalid = await as(ctx, actor)
        .put('/api/v1/users/me/preferences')
        .send({ theme: 'neon' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });
  describe('per-account login lockout', () => {
    it('locks an account after 10 failed logins (even with the right password), other accounts keep working, and expiry unlocks it', async () => {
      const victim = await register(ctx, { email: uniqueEmail('lockout') });
      const other = await register(ctx, { email: uniqueEmail('lockout-other') });

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const bad = await anon(ctx)
          .post('/api/v1/auth/login')
          .send({ email: victim.email, password: 'Wrong-password-1!' });
        expect(bad.status).toBe(401);
      }

      const locked = await anon(ctx)
        .post('/api/v1/auth/login')
        .send({ email: victim.email, password: PASSWORD });
      expect(locked.status).toBe(429);
      expect(locked.body.error.code).toBe(ErrorCode.RATE_LIMITED);
      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: {
          action: AuditAction.AUTH_LOGIN_FAILED,
          metadata: { path: ['reason'], equals: 'locked' },
        },
      });
      expect(audit).not.toBeNull();

      // Another account is unaffected, and a session that already exists keeps working.
      await login(ctx, other.email);
      expect((await as(ctx, victim).get('/api/v1/auth/me')).status).toBe(200);

      // The window expiring (simulated by dropping the counters) unlocks the account.
      const redis = await ctx.app.get(RedisService).ensureConnected();
      const keys = await redis.keys('auth:login-failures:*');
      if (keys.length) await redis.del(...keys);
      await login(ctx, victim.email);
    });

    it('a successful login clears the failure count', async () => {
      const actor = await register(ctx, { email: uniqueEmail('lockout-reset') });
      for (let round = 0; round < 3; round += 1) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await anon(ctx)
            .post('/api/v1/auth/login')
            .send({ email: actor.email, password: 'Wrong-password-1!' });
        }
        await login(ctx, actor.email);
      }
    });
  });
});
