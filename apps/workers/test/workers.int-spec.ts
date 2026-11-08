/**
 * Integration: boots the real workers application against the local Redis (isolated BullMQ prefix
 * `hta-test`, see setup-env.ts) and the `hilatech_test` database, enqueues jobs the way the API
 * does (payload from the contracts, `idempotencyKey` as jobId, `DEFAULT_JOB_OPTIONS`) and asserts
 * what the workers did. Everything created in the database is removed afterwards.
 */
import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  DEFAULT_JOB_OPTIONS,
  QueueName,
  type AiTaskJob,
  type AnalyticsJob,
  type EmailJob,
  type NotificationJob,
} from '@hilatech/contracts';
import { Job, Queue, QueueEvents } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { HealthServer } from '../src/health/health.server';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueRegistry } from '../src/queue/queue.registry';
import { RedisService } from '../src/redis/redis.service';

const PREFIX = process.env.BULLMQ_PREFIX!;
const TEST_QUEUES = [QueueName.EMAIL, QueueName.NOTIFICATIONS, QueueName.AI_TASKS, QueueName.ANALYTICS] as const;

// NOTE: BullMQ 5 rejects custom job ids that contain ':' (unless exactly 3 segments) or that are pure
// integers. Producers use `idempotencyKey` as the jobId, so keys in these tests avoid ':'.

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor: condition not met in time');
}

describe('workers (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let connection: RedisOptions;
  const producers = new Map<QueueName, Queue>();
  const events = new Map<QueueName, QueueEvents>();
  let userId: string;
  let organizationId: string;

  const producer = (q: QueueName): Queue => producers.get(q)!;
  const eventsOf = (q: QueueName): QueueEvents => events.get(q)!;
  const base = () => ({ enqueuedAt: new Date().toISOString(), requestId: `int-${randomUUID()}` });

  beforeAll(async () => {
    expect(PREFIX).toBe('hta-test');
    expect(process.env.DATABASE_URL).toMatch(/_test(\?|$)/);

    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    prisma = app.get(PrismaService);
    connection = app.get(RedisService).connectionOptions;

    for (const q of TEST_QUEUES) {
      producers.set(q, new Queue(q, { connection: { ...connection }, prefix: PREFIX }));
      const ev = new QueueEvents(q, { connection: { ...connection }, prefix: PREFIX });
      await ev.waitUntilReady();
      events.set(q, ev);
    }
    // Leftovers from an interrupted run must not be picked up by this one.
    await Promise.all([...producers.values()].map((q) => q.drain(true)));

    const user = await prisma.client.user.create({
      data: { email: `workers-int-${randomUUID()}@test.local`, passwordHash: 'not-a-real-hash', firstName: 'Workers', lastName: 'Integration' },
      select: { id: true },
    });
    userId = user.id;
    const org = await prisma.client.organization.create({
      data: { name: 'Workers Integration Org', slug: `workers-int-${randomUUID().slice(0, 8)}` },
      select: { id: true },
    });
    organizationId = org.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.client.notification.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.client.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
      await prisma.client.organization.deleteMany({ where: { id: organizationId } }).catch(() => undefined);
    }
    await Promise.all([...events.values()].map((e) => e.close()));
    await Promise.all([...producers.values()].map((q) => q.close()));
    if (app) await app.close();
    // Leave Redis clean: remove every key of the test prefix now that no worker holds them.
    for (const q of Object.values(QueueName)) {
      const queue = new Queue(q, { connection: { ...connection }, prefix: PREFIX });
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  });

  it('starts one worker per queue in the contract', () => {
    const registry = app.get(QueueRegistry);
    expect(registry.activeQueues().sort()).toEqual([...Object.values(QueueName)].sort());
    expect(registry.worker(QueueName.AI_TASKS)?.opts.lockDuration).toBe(5 * 60_000);
  });

  it('processes an email job with the log driver', async () => {
    const idempotencyKey = `email-int-${randomUUID()}`;
    const payload: EmailJob = {
      ...base(),
      organizationId: null,
      idempotencyKey,
      to: 'someone@test.local',
      template: 'verify_email',
      variables: { token: `tok_${randomUUID()}`, firstName: 'Int' },
    };
    const job = await producer(QueueName.EMAIL).add('email', payload, { ...DEFAULT_JOB_OPTIONS, jobId: idempotencyKey });
    const result = await job.waitUntilFinished(eventsOf(QueueName.EMAIL), 20_000);

    expect(result).toMatchObject({ status: 'completed', template: 'verify_email', driver: 'log', messageId: null });

    // Producer-side idempotency: re-adding with the same jobId does not create a new job.
    const again = await producer(QueueName.EMAIL).add('email', payload, { ...DEFAULT_JOB_OPTIONS, jobId: idempotencyKey });
    expect(again.id).toBe(idempotencyKey);
    expect(await again.getState()).toBe('completed');
  });

  it('fails an invalid payload permanently (UnrecoverableError, single attempt)', async () => {
    const jobId = `email-bad-${randomUUID()}`;
    const job = await producer(QueueName.EMAIL).add('email', { not: 'a valid payload' }, { ...DEFAULT_JOB_OPTIONS, jobId });

    await expect(job.waitUntilFinished(eventsOf(QueueName.EMAIL), 20_000)).rejects.toThrow(/Invalid payload for queue "email"/);

    const failed = await Job.fromId(producer(QueueName.EMAIL), jobId);
    expect(failed).toBeDefined();
    expect(await failed!.getState()).toBe('failed');
    expect(failed!.attemptsMade).toBe(1); // DEFAULT_JOB_OPTIONS.attempts is 5 — no retries happened
  });

  it('creates a Notification row once per (userId, idempotencyKey)', async () => {
    const idempotencyKey = `notif-int-${randomUUID()}`;
    const payload: NotificationJob = {
      ...base(),
      organizationId: null,
      idempotencyKey,
      userId,
      type: 'system',
      title: 'Workers integration test',
      body: 'Created by apps/workers test suite',
      link: '/settings',
      data: { source: 'int-spec' },
    };

    const job = await producer(QueueName.NOTIFICATIONS).add('notifications', payload, { ...DEFAULT_JOB_OPTIONS, jobId: idempotencyKey });
    const result = await job.waitUntilFinished(eventsOf(QueueName.NOTIFICATIONS), 20_000);
    expect(result).toMatchObject({ status: 'completed', type: 'system' });

    const rows = await prisma.client.notification.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: (result as { notificationId: string }).notificationId,
      organizationId: null,
      type: 'system',
      title: payload.title,
      body: payload.body,
      link: payload.link,
      data: { source: 'int-spec', idempotencyKey },
      readAt: null,
    });

    // Same idempotency key delivered again under a different job id (e.g. producer re-enqueued after
    // the first job was already removed): no second row.
    const dup = await producer(QueueName.NOTIFICATIONS).add('notifications', payload, { ...DEFAULT_JOB_OPTIONS, jobId: `${idempotencyKey}-redelivered` });
    const dupResult = await dup.waitUntilFinished(eventsOf(QueueName.NOTIFICATIONS), 20_000);
    expect(dupResult).toMatchObject({ status: 'skipped', reason: 'duplicate', notificationId: rows[0]!.id });
    expect(await prisma.client.notification.count({ where: { userId } })).toBe(1);
  });

  it('completes not-yet-implemented queues with a skipped outcome instead of failing', async () => {
    const idempotencyKey = `ai-int-${randomUUID()}`;
    const payload: AiTaskJob = {
      ...base(),
      organizationId,
      idempotencyKey,
      kind: 'conversation_summary',
      targetId: randomUUID(),
      requestedByUserId: null,
    };
    const job = await producer(QueueName.AI_TASKS).add('ai-tasks', payload, { ...DEFAULT_JOB_OPTIONS, jobId: idempotencyKey });
    const result = await job.waitUntilFinished(eventsOf(QueueName.AI_TASKS), 20_000);
    expect(result).toMatchObject({ status: 'skipped', reason: 'not_implemented' });
    expect(await job.getState()).toBe('completed');
  });

  it('computes (and does not persist) the analytics daily_rollup for an organization', async () => {
    const contact = await prisma.client.contact.create({ data: { organizationId, firstName: 'Rollup' }, select: { id: true } });
    const today = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `analytics-int-${randomUUID()}`;
    const payload: AnalyticsJob = { ...base(), organizationId, idempotencyKey, kind: 'daily_rollup', date: today };

    const job = await producer(QueueName.ANALYTICS).add('analytics', payload, { ...DEFAULT_JOB_OPTIONS, jobId: idempotencyKey });
    const result = await job.waitUntilFinished(eventsOf(QueueName.ANALYTICS), 20_000);

    expect(result).toMatchObject({
      status: 'completed',
      kind: 'daily_rollup',
      date: today,
      organizations: 1,
      totals: { leads: 0, contacts: 1, conversations: 0 },
      persisted: false,
    });
    await prisma.client.contact.delete({ where: { id: contact.id } });
  });

  it('serves GET /health with per-queue counts', async () => {
    const port = app.get(HealthServer).port;
    expect(port).toBeGreaterThan(0);

    const getHealth = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    type Counts = Record<string, Record<string, unknown>>;

    // The event-stream counters are updated asynchronously; give them a moment to catch up.
    await waitFor(async () => {
      const { body } = await getHealth();
      const sinceStart = (body.queues as Counts)[QueueName.NOTIFICATIONS]?.sinceStart as { completed: number } | undefined;
      return (sinceStart?.completed ?? 0) >= 2;
    });

    const { status, body } = await getHealth();
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', redis: 'up', database: 'up', version: expect.any(String), uptimeSeconds: expect.any(Number) });
    const queues = body.queues as Counts;
    expect(Object.keys(queues).sort()).toEqual([...Object.values(QueueName)].sort());
    expect(queues[QueueName.EMAIL]).toMatchObject({ waiting: 0, active: 0, delayed: 0, failed: 1 });
    expect((queues[QueueName.EMAIL]!.completed as number) >= 1).toBe(true);
    expect(queues[QueueName.NOTIFICATIONS]!.sinceStart).toMatchObject({ completed: 2, failed: 0, stalled: 0 });
    expect(queues[QueueName.EMAIL]!.sinceStart).toMatchObject({ failed: 1 });

    const notFound = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(notFound.status).toBe(404);
  });
});
