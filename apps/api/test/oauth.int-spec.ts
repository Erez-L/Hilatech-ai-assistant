// Must stay the first import: it sets the environment before the app module (and its ConfigModule) loads.
import './setup/oauth-env';

import { AuditAction } from '@hilatech/contracts';
import request from 'supertest';

import { OAuthService } from '../src/modules/auth/oauth/oauth.service';
import {
  PASSWORD,
  type TestContext,
  createTestApp,
  emailJobsTo,
  login,
  refreshCookieFrom,
  register,
  resetDatabase,
  uniqueEmail,
} from './setup/test-app';

interface FakeAccount {
  id: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
}

/** Replaces the outbound provider calls: the token endpoint and the profile endpoints. */
function stubProvider(ctx: TestContext, account: FakeAccount | 'token-fails') {
  const calls: string[] = [];
  ctx.app.get(OAuthService).fetchFn = async (url) => {
    calls.push(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url.includes('/token') || url.includes('/oauth/access_token')) {
      return account === 'token-fails'
        ? json({ error: 'invalid_grant' }, 400)
        : json({ access_token: 'provider-access-token' });
    }
    if (account === 'token-fails') return json({}, 500);
    if (url.includes('googleapis.com')) {
      return json({
        sub: account.id,
        email: account.email,
        email_verified: account.emailVerified ?? true,
        given_name: account.firstName ?? 'Gal',
        family_name: account.lastName ?? 'Cohen',
      });
    }
    if (url.includes('graph.facebook.com/me')) {
      return json({ id: account.id, email: account.email, first_name: 'Fay', last_name: 'Book' });
    }
    return json({}, 404);
  };
  return calls;
}

/** Runs start → callback like a browser would and returns the callback response. */
async function signIn(ctx: TestContext, provider: string, next?: string) {
  const start = await request(ctx.http)
    .get(`/api/v1/auth/oauth/${provider}/start`)
    .query(next ? { next } : {});
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.location as string);
  const stateCookie = (start.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('hta_oauth='))!
    .split(';')[0]!;
  const callback = await request(ctx.http)
    .get(`/api/v1/auth/oauth/${provider}/callback`)
    .set('Cookie', stateCookie)
    .query({ code: 'auth-code', state: authorize.searchParams.get('state') });
  return { authorize, callback, stateCookie };
}

const errorOf = (res: request.Response) =>
  new URL(res.headers.location as string).searchParams.get('oauth_error');

describe('Social sign-in (OAuth)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
    for (const key of Object.keys(process.env))
      if (key.startsWith('OAUTH_')) delete process.env[key];
  });

  it('lists only the providers that have credentials', async () => {
    const res = await request(ctx.http).get('/api/v1/auth/oauth/providers');
    expect(res.status).toBe(200);
    expect(res.body.data.providers).toEqual(['google', 'facebook']);
  });

  it('start redirects to the provider with our client id, callback URL and a state', async () => {
    const start = await request(ctx.http).get('/api/v1/auth/oauth/google/start');
    const url = new URL(start.headers.location as string);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-google-id');
    expect(url.searchParams.get('redirect_uri')).toMatch(
      /\/api\/v1\/auth\/oauth\/google\/callback$/,
    );
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(start.headers.location).not.toContain('test-google-secret');
  });

  it('a provider without credentials, or an unknown one, is refused', async () => {
    const unconfigured = await request(ctx.http).get('/api/v1/auth/oauth/github/start');
    expect(unconfigured.status).toBe(302);
    expect(errorOf(unconfigured)).toBe('not_configured');
    expect((await request(ctx.http).get('/api/v1/auth/oauth/myspace/start')).status).toBe(404);
  });

  it('a new Google user gets a verified account, a session cookie and no verification email', async () => {
    const email = uniqueEmail('google-new');
    stubProvider(ctx, { id: 'g-1', email });
    const { callback } = await signIn(ctx, 'google', '/leads?view=mine');

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toMatch(/\/leads\?view=mine$/);
    const refresh = await request(ctx.http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookieFrom(callback));
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.user.email).toBe(email);
    expect(refresh.body.data.user.emailVerifiedAt).not.toBeNull();

    const user = await ctx.prisma.client.user.findUniqueOrThrow({
      where: { email },
      include: { identities: true },
    });
    expect(user.firstName).toBe('Gal');
    expect(user.identities).toHaveLength(1);
    expect(await emailJobsTo(ctx, email, 'verify_email')).toHaveLength(0);
    const audit = await ctx.prisma.client.auditLog.findMany({ where: { actorUserId: user.id } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([AuditAction.AUTH_REGISTER, AuditAction.AUTH_LOGIN]),
    );
  });

  it('signing in again with the same identity reuses the account, even if the email changed', async () => {
    const before = await ctx.prisma.client.user.count();
    stubProvider(ctx, { id: 'g-1', email: uniqueEmail('changed') });
    const { callback } = await signIn(ctx, 'google');
    expect(callback.headers.location).toMatch(/\/dashboard$/);
    expect(await ctx.prisma.client.user.count()).toBe(before);
  });

  it('a verified Google email links to an existing verified account and keeps its password', async () => {
    const actor = await register(ctx, { email: uniqueEmail('link') });
    await ctx.prisma.client.user.update({
      where: { email: actor.email },
      data: { emailVerifiedAt: new Date() },
    });
    stubProvider(ctx, { id: 'g-link', email: actor.email });
    const { callback } = await signIn(ctx, 'google');
    expect(errorOf(callback)).toBeNull();
    expect(
      await ctx.prisma.client.userIdentity.count({ where: { user: { email: actor.email } } }),
    ).toBe(1);
    await expect(login(ctx, actor.email, PASSWORD)).resolves.toBeTruthy();
  });

  it('linking to an account that never verified its email discards its password and sessions', async () => {
    const squatter = await register(ctx, { email: uniqueEmail('squat') });
    stubProvider(ctx, { id: 'g-owner', email: squatter.email });
    const { callback } = await signIn(ctx, 'google');
    expect(errorOf(callback)).toBeNull();

    await expect(login(ctx, squatter.email, PASSWORD)).rejects.toThrow();
    const oldSession = await request(ctx.http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', squatter.refreshCookie);
    expect(oldSession.status).toBe(401);
    const user = await ctx.prisma.client.user.findUniqueOrThrow({
      where: { email: squatter.email },
    });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it('an unverified provider email is never linked to an existing account', async () => {
    const actor = await register(ctx, { email: uniqueEmail('fb-existing') });
    stubProvider(ctx, { id: 'fb-1', email: actor.email });
    const { callback } = await signIn(ctx, 'facebook');
    expect(errorOf(callback)).toBe('account_exists');
    expect(callback.headers['set-cookie']?.toString() ?? '').not.toContain('refresh');
    expect(await ctx.prisma.client.userIdentity.count({ where: { providerUserId: 'fb-1' } })).toBe(
      0,
    );
  });

  it('a new account from an unverified provider email must still verify it', async () => {
    const email = uniqueEmail('fb-new');
    stubProvider(ctx, { id: 'fb-2', email });
    const { callback } = await signIn(ctx, 'facebook');
    expect(errorOf(callback)).toBeNull();
    const user = await ctx.prisma.client.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(await emailJobsTo(ctx, email, 'verify_email')).toHaveLength(1);
  });

  it('refuses a callback whose state does not match the cookie, or that has no cookie', async () => {
    stubProvider(ctx, { id: 'g-state', email: uniqueEmail('state') });
    const start = await request(ctx.http).get('/api/v1/auth/oauth/google/start');
    const cookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const forged = await request(ctx.http)
      .get('/api/v1/auth/oauth/google/callback')
      .set('Cookie', cookie)
      .query({ code: 'auth-code', state: 'attacker-state' });
    expect(errorOf(forged)).toBe('state_mismatch');
    const noCookie = await request(ctx.http)
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'auth-code', state: 'anything' });
    expect(errorOf(noCookie)).toBe('state_mismatch');
    expect(
      await ctx.prisma.client.userIdentity.count({ where: { providerUserId: 'g-state' } }),
    ).toBe(0);
  });

  it('a cancelled consent, a failing provider and a missing email each give their own error', async () => {
    stubProvider(ctx, { id: 'g-x', email: uniqueEmail('x') });
    const start = await request(ctx.http).get('/api/v1/auth/oauth/google/start');
    const state = new URL(start.headers.location as string).searchParams.get('state');
    const cookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const cancelled = await request(ctx.http)
      .get('/api/v1/auth/oauth/google/callback')
      .set('Cookie', cookie)
      .query({ error: 'access_denied', state });
    expect(errorOf(cancelled)).toBe('cancelled');

    stubProvider(ctx, 'token-fails');
    expect(errorOf((await signIn(ctx, 'google')).callback)).toBe('provider_failed');

    stubProvider(ctx, { id: 'g-noemail' });
    expect(errorOf((await signIn(ctx, 'google')).callback)).toBe('email_missing');
  });

  it('never follows an absolute or protocol-relative "next"', async () => {
    for (const next of ['https://evil.example/x', '//evil.example/x', '/\\evil.example']) {
      stubProvider(ctx, { id: 'g-1', email: uniqueEmail('n') });
      const { callback } = await signIn(ctx, 'google', next);
      expect(callback.headers.location).toMatch(/\/dashboard$/);
    }
  });
});
