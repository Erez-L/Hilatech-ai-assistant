import {
  ORGANIZATION_HEADER,
  QueueName,
  REFRESH_COOKIE_NAME,
  type AuthResponse,
  type Organization,
} from '@hilatech/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplication } from '@nestjs/common';
import { type Queue } from 'bullmq';
import request, { type Response, type Test } from 'supertest';

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createApp } from '../../src/main';

export interface TestContext {
  app: INestApplication;
  http: Parameters<typeof request>[0];
  prisma: PrismaService;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const app = await createApp({ logger: false });
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, http: app.getHttpServer(), prisma, close: () => app.close() };
}

/** Truncate every data table (keeps the migration history and the Permission catalog). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const rows = await prisma.client.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const tables = rows
    .map((r) => r.table_name)
    .filter((t) => t !== '_prisma_migrations' && t !== 'Permission');
  await prisma.client.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}@test.local`;
}

export const PASSWORD = 'Str0ngPassword!';

export interface Actor {
  email: string;
  password: string;
  accessToken: string;
  refreshCookie: string;
  user: AuthResponse['user'];
  organizations: AuthResponse['organizations'];
}

export function refreshCookieFrom(res: Response): string {
  const raw = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!cookie) throw new Error('refresh cookie not set');
  return cookie.split(';')[0] as string;
}

export function refreshCookieHeaders(res: Response): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

export async function register(
  ctx: TestContext,
  overrides: Partial<{
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    invitationToken: string;
  }> = {},
): Promise<Actor> {
  const body = {
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? PASSWORD,
    firstName: overrides.firstName ?? 'Test',
    lastName: overrides.lastName ?? 'User',
    ...(overrides.invitationToken ? { invitationToken: overrides.invitationToken } : {}),
  };
  const res = await request(ctx.http).post('/api/v1/auth/register').send(body);
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const data = res.body.data as AuthResponse;
  return {
    email: body.email,
    password: body.password,
    accessToken: data.accessToken,
    refreshCookie: refreshCookieFrom(res),
    user: data.user,
    organizations: data.organizations,
  };
}

export async function login(ctx: TestContext, email: string, password = PASSWORD): Promise<Actor> {
  const res = await request(ctx.http).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const data = res.body.data as AuthResponse;
  return {
    email,
    password,
    accessToken: data.accessToken,
    refreshCookie: refreshCookieFrom(res),
    user: data.user,
    organizations: data.organizations,
  };
}

export async function createOrganization(
  ctx: TestContext,
  actor: Actor,
  name = 'Test Org',
): Promise<Organization> {
  const res = await request(ctx.http)
    .post('/api/v1/organizations')
    .set('Authorization', `Bearer ${actor.accessToken}`)
    .send({ name });
  if (res.status !== 201)
    throw new Error(`createOrganization failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as Organization;
}

/** Supertest request pre-authenticated (and optionally tenant-scoped). */
export function as(ctx: TestContext, actor: Pick<Actor, 'accessToken'>, organizationId?: string) {
  const apply = (t: Test) => {
    t.set('Authorization', `Bearer ${actor.accessToken}`);
    if (organizationId) t.set(ORGANIZATION_HEADER, organizationId);
    return t;
  };
  const agent = request(ctx.http);
  return {
    get: (url: string) => apply(agent.get(url)),
    post: (url: string) => apply(agent.post(url)),
    put: (url: string) => apply(agent.put(url)),
    patch: (url: string) => apply(agent.patch(url)),
    delete: (url: string) => apply(agent.delete(url)),
  };
}

export function anon(ctx: TestContext) {
  return request(ctx.http);
}

/** Jobs the API produced on a queue (BullMQ in the test Redis database), newest first. */
export async function jobsOn(
  ctx: TestContext,
  queue: QueueName,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const q = ctx.app.get<Queue>(getQueueToken(queue));
  const jobs = await q.getJobs(
    ['waiting', 'delayed', 'prioritized', 'paused', 'active', 'completed', 'failed'],
    0,
    500,
    false,
  );
  return jobs
    .filter((j): j is NonNullable<typeof j> => Boolean(j))
    .map((j) => ({ id: String(j.id), data: j.data as Record<string, unknown> }));
}

export async function emailJobsTo(ctx: TestContext, to: string, template?: string) {
  const jobs = await jobsOn(ctx, QueueName.EMAIL);
  return jobs.filter((j) => j.data.to === to && (!template || j.data.template === template));
}

export async function lastEmailToken(
  ctx: TestContext,
  to: string,
  template: string,
): Promise<string> {
  const jobs = await emailJobsTo(ctx, to, template);
  if (jobs.length === 0) throw new Error(`no ${template} email job for ${to}`);
  const variables = jobs[jobs.length - 1]!.data.variables as { token?: string };
  if (!variables.token) throw new Error(`email job for ${to} has no token variable`);
  return variables.token;
}

export const SENSITIVE_FRAGMENTS = [
  'passwordHash',
  'tokenHash',
  '"refreshToken"',
  'JWT_',
  'argon2',
];

export function expectNoSensitiveLeak(body: unknown, extraSecrets: string[] = []): void {
  const text = JSON.stringify(body);
  for (const fragment of [...SENSITIVE_FRAGMENTS, ...extraSecrets]) {
    expect(text).not.toContain(fragment);
  }
}
