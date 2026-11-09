import { ErrorCode, REFRESH_COOKIE_NAME } from '@hilatech/contracts';
import { JwtService } from '@nestjs/jwt';

import { AppConfig } from '../../src/config/app-config.service';
import {
  type Actor,
  type TestContext,
  anon,
  as,
  createTestApp,
  login,
  refreshCookieHeaders,
  register,
  resetDatabase,
} from '../setup/test-app';

describe('Security: access and refresh tokens', () => {
  let ctx: TestContext;
  let actor: Actor;
  let secret: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    actor = await register(ctx);
    secret = ctx.app.get(AppConfig).get('JWT_ACCESS_SECRET');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('missing / malformed / wrongly-signed tokens are rejected with distinct codes and no stack traces', async () => {
    const missing = await anon(ctx).get('/api/v1/users/me');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe(ErrorCode.UNAUTHORIZED);

    const malformed = await anon(ctx)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not.a.jwt');
    expect(malformed.status).toBe(401);
    expect(malformed.body.error.code).toBe(ErrorCode.TOKEN_INVALID);

    const forged = new JwtService({ secret: 'wrong-secret-wrong-secret-wrong-secret-0000' }).sign(
      { sub: actor.user.id, email: actor.email, sid: '00000000-0000-4000-8000-000000000000' },
      { expiresIn: 600 },
    );
    const wrongSig = await anon(ctx)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${forged}`);
    expect(wrongSig.status).toBe(401);
    expect(wrongSig.body.error.code).toBe(ErrorCode.TOKEN_INVALID);

    const basic = await anon(ctx).get('/api/v1/users/me').set('Authorization', 'Basic abc');
    expect(basic.status).toBe(401);
    for (const res of [missing, malformed, wrongSig, basic])
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });

  it('expired access tokens → 401 TOKEN_EXPIRED', async () => {
    const expired = new JwtService({ secret }).sign(
      { sub: actor.user.id, email: actor.email, sid: '00000000-0000-4000-8000-000000000000' },
      { expiresIn: -10 },
    );
    const res = await anon(ctx).get('/api/v1/users/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.TOKEN_EXPIRED);
  });

  it('tokens with the "none" algorithm or missing claims are rejected', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: actor.user.id,
        email: actor.email,
        sid: 'x',
        iat: 1,
        exp: 9_999_999_999,
      }),
    ).toString('base64url');
    const none = await anon(ctx)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${header}.${payload}.`);
    expect(none.status).toBe(401);

    const noSid = new JwtService({ secret }).sign(
      { sub: actor.user.id, email: actor.email },
      { expiresIn: 600 },
    );
    const res = await anon(ctx).get('/api/v1/users/me').set('Authorization', `Bearer ${noSid}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
  });

  it('a valid token for a deactivated or deleted user is rejected immediately', async () => {
    const victim = await register(ctx);
    await ctx.prisma.client.user.update({
      where: { id: victim.user.id },
      data: { isActive: false },
    });
    const inactive = await as(ctx, victim).get('/api/v1/users/me');
    expect(inactive.status).toBe(401);

    await ctx.prisma.client.user.delete({ where: { id: victim.user.id } });
    const deleted = await as(ctx, victim).get('/api/v1/users/me');
    expect(deleted.status).toBe(401);
  });

  it('refresh token reuse revokes the entire family (both the replayed and the current token)', async () => {
    const session = await login(ctx, actor.email);
    const first = await anon(ctx).post('/api/v1/auth/refresh').set('Cookie', session.refreshCookie);
    expect(first.status).toBe(200);
    const current = refreshCookieHeaders(first)[0]!.split(';')[0]!;

    const replay = await anon(ctx)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe(ErrorCode.TOKEN_REUSED);

    const legit = await anon(ctx).post('/api/v1/auth/refresh').set('Cookie', current);
    expect(legit.status).toBe(401);
    expect(legit.body.error.code).toBe(ErrorCode.TOKEN_INVALID);

    // the replayed family is fully revoked in the database (2 tokens: original + rotated)
    const familyId = (await ctx.prisma.client.refreshToken.findFirst({
      where: { userId: actor.user.id },
      orderBy: { createdAt: 'desc' },
    }))!.familyId;
    const family = await ctx.prisma.client.refreshToken.findMany({ where: { familyId } });
    expect(family).toHaveLength(2);
    expect(family.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it('refresh tokens are never accepted via header or body — only the cookie', async () => {
    const session = await login(ctx, actor.email);
    const raw = session.refreshCookie.split('=')[1]!;
    const viaBody = await anon(ctx).post('/api/v1/auth/refresh').send({ refreshToken: raw });
    expect(viaBody.status).toBe(401);
    const viaHeader = await anon(ctx)
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${raw}`);
    expect(viaHeader.status).toBe(401);
    const unknownCookie = await anon(ctx)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${'a'.repeat(64)}`);
    expect(unknownCookie.status).toBe(401);
    expect(unknownCookie.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
  });

  it('access tokens are user-scoped: a stolen token cannot pick an organization the user is not in', async () => {
    const outsider = await register(ctx);
    const res = await as(ctx, outsider, '00000000-0000-4000-8000-000000000000').get(
      '/api/v1/members',
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
  });
});
