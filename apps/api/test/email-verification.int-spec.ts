// Must stay the first import: it sets the environment before the app module (and its ConfigModule) loads.
import './setup/require-email-verification';

import { AuditAction, ErrorCode } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  anon,
  as,
  createTestApp,
  emailJobsTo,
  lastEmailToken,
  register,
  resetDatabase,
  uniqueEmail,
} from './setup/test-app';

describe('Email verification enforcement (REQUIRE_EMAIL_VERIFICATION=true)', () => {
  let ctx: TestContext;
  let actor: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    actor = await register(ctx, { email: uniqueEmail('unverified') });
  });

  afterAll(async () => {
    await ctx.close();
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    delete process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN;
  });

  it('an unverified user keeps the session and profile routes', async () => {
    const me = await as(ctx, actor).get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.emailVerifiedAt).toBeNull();
    expect((await as(ctx, actor).get('/api/v1/users/me')).status).toBe(200);
    expect((await as(ctx, actor).get('/api/v1/auth/sessions')).status).toBe(200);
  });

  it('everything else answers 403 EMAIL_NOT_VERIFIED, and nothing is created', async () => {
    const create = await as(ctx, actor)
      .post('/api/v1/organizations')
      .send({ name: 'Blocked Org', slug: `blocked-${Date.now().toString(36)}` });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe(ErrorCode.EMAIL_NOT_VERIFIED);
    expect(await ctx.prisma.client.organization.count()).toBe(0);

    const list = await as(ctx, actor).get('/api/v1/organizations');
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe(ErrorCode.EMAIL_NOT_VERIFIED);
  });

  it('public routes are unaffected', async () => {
    expect((await anon(ctx).get('/api/v1/health')).status).toBe(200);
  });

  it('resend is rate limited by the cooldown (registration just sent one)', async () => {
    const res = await as(ctx, actor).post('/api/v1/auth/resend-verification');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(await emailJobsTo(ctx, actor.email, 'verify_email')).toHaveLength(1);
  });

  it('resend sends a new email once the cooldown has passed, and is audited', async () => {
    await ctx.prisma.client.emailVerificationToken.updateMany({
      data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    const res = await as(ctx, actor).post('/api/v1/auth/resend-verification');
    expect(res.status).toBe(204);
    expect(await emailJobsTo(ctx, actor.email, 'verify_email')).toHaveLength(2);
    const audit = await ctx.prisma.client.auditLog.findFirst({
      where: { action: AuditAction.AUTH_EMAIL_VERIFICATION_RESENT },
    });
    expect(audit?.actorUserId).toBeDefined();
  });

  it('resend requires authentication', async () => {
    expect((await anon(ctx).post('/api/v1/auth/resend-verification')).status).toBe(401);
  });

  it('verifying with the emailed token unlocks the account immediately; resend becomes a no-op', async () => {
    const token = await lastEmailToken(ctx, actor.email, 'verify_email');
    const verify = await anon(ctx).post('/api/v1/auth/verify-email').send({ token });
    expect(verify.status).toBe(204);

    const create = await as(ctx, actor)
      .post('/api/v1/organizations')
      .send({ name: 'Allowed Org', slug: `allowed-${Date.now().toString(36)}` });
    expect(create.status).toBe(201);

    const before = (await emailJobsTo(ctx, actor.email, 'verify_email')).length;
    const resend = await as(ctx, actor).post('/api/v1/auth/resend-verification');
    expect(resend.status).toBe(204);
    expect(await emailJobsTo(ctx, actor.email, 'verify_email')).toHaveLength(before);
  });
});
