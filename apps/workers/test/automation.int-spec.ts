/**
 * Integration: the automation consumers (`automation`, `webhook-delivery`) against the real workers
 * application, the test database and Redis. Event fan-out, the schedule tick and the delivery
 * attempts are driven by calling the processors directly (deterministic); the execution of the
 * created runs goes through the real BullMQ workers. Outbound HTTP targets are local servers
 * (loopback is allowed because NODE_ENV is not production).
 *
 * Everything is created under two organizations and removed afterwards (cascade).
 */
import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ALL_PERMISSIONS, DEFAULT_JOB_OPTIONS, QueueName } from '@hilatech/contracts';
import { SecretBox, verifyOutboundSignature } from '@hilatech/shared';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AutomationProcessor } from '../src/automation/automation.processor';
import { WebhookDeliveryProcessor } from '../src/automation/webhook-delivery.processor';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

const PREFIX = process.env.BULLMQ_PREFIX!;
const SIGNING_SECRET = 'whsec_integration_secret';

interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  ms = 20_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 75));
  }
  throw new Error('waitFor: condition not met in time');
}

describe('automation (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let automation: AutomationProcessor;
  let delivery: WebhookDeliveryProcessor;
  let box: SecretBox;
  let producer: Queue;

  let server: Server;
  let serverUrl: string;
  const captured: Captured[] = [];
  let serverStatus = 200;

  let orgA: string;
  let orgB: string;
  let userA: string;
  let userB: string;
  let leadA: string;
  let leadB: string;

  const db = () => prisma.client;
  const base = () => ({ enqueuedAt: new Date().toISOString(), requestId: `int-${randomUUID()}` });

  const makeOrg = async (label: string, timezone = 'UTC') => {
    const user = await db().user.create({
      data: {
        email: `auto-int-${label}-${randomUUID()}@test.local`,
        passwordHash: 'not-a-real-hash',
        firstName: label,
        lastName: 'Automation',
      },
      select: { id: true },
    });
    const org = await db().organization.create({
      data: {
        name: `Automation Int ${label}`,
        slug: `auto-int-${label}-${randomUUID().slice(0, 8)}`,
        timezone,
        roles: {
          create: {
            key: 'owner',
            name: 'Owner',
            isSystem: true,
            permissions: [...ALL_PERMISSIONS],
          },
        },
      },
      select: { id: true, roles: { select: { id: true } } },
    });
    await db().organizationMember.create({
      data: { organizationId: org.id, userId: user.id, roleId: org.roles[0]!.id, status: 'active' },
    });
    const lead = await db().lead.create({
      data: { organizationId: org.id, title: `Lead ${label}`, assigneeId: user.id },
      select: { id: true },
    });
    return { orgId: org.id, userId: user.id, leadId: lead.id };
  };

  const createWorkflow = (
    organizationId: string,
    name: string,
    trigger: Record<string, unknown>,
    steps: Record<string, unknown>[],
    extra: { isEnabled?: boolean; updatedAt?: Date } = {},
  ) =>
    db().workflow.create({
      data: {
        organizationId,
        name: `${name}-${randomUUID().slice(0, 6)}`,
        isEnabled: extra.isEnabled ?? true,
        trigger: trigger as never,
        steps: steps as never,
        ...(extra.updatedAt ? { updatedAt: extra.updatedAt } : {}),
      },
      select: { id: true },
    });

  const finished = (executionId: string) =>
    waitFor(async () => {
      const e = await db().workflowExecution.findUnique({ where: { id: executionId } });
      return e && ['succeeded', 'failed', 'cancelled'].includes(e.status) ? e : null;
    });

  const executionsOf = (workflowId: string) =>
    db().workflowExecution.findMany({ where: { workflowId }, orderBy: { createdAt: 'asc' } });

  const eventJob = (organizationId: string, event: string, payload: Record<string, unknown>) => ({
    kind: 'event' as const,
    organizationId,
    event,
    payload: { organizationId, ...payload },
    actorUserId: null,
    idempotencyKey: `evt-${event}-${randomUUID()}`,
    ...base(),
  });

  const createWebhook = async (
    organizationId: string,
    url: string,
    events: string[] = ['lead.created'],
  ) =>
    db().webhook.create({
      data: {
        organizationId,
        url,
        events,
        encryptedSecret: box.encrypt(SIGNING_SECRET, organizationId),
        secretLast4: SIGNING_SECRET.slice(-4),
      },
      select: { id: true },
    });

  const createDelivery = (
    organizationId: string,
    webhookId: string,
    attempts = 0,
    event = 'lead.created',
  ) =>
    db().webhookDelivery.create({
      data: {
        organizationId,
        webhookId,
        event,
        payload: { lead: { id: 'l-1' }, n: attempts },
        status: 'pending',
        attempts,
        nextAttemptAt: new Date(),
      },
    });

  /** Runs one delivery attempt through the processor and returns the reloaded row. */
  const attempt = async (organizationId: string, deliveryId: string, attempts: number) => {
    const job = {
      data: {
        organizationId,
        deliveryId,
        attempt: attempts,
        idempotencyKey: `t-${randomUUID()}`,
        ...base(),
      },
    };
    await delivery.process(job as never, { requestId: 'int', jobId: 'int' } as never);
    return db().webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  };

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toMatch(/_test(\w*)(\?|$)/);
    expect(process.env.AUTOMATION_SCHEDULER_ENABLED).toBe('false');

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        captured.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.statusCode = serverStatus;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: serverStatus < 400 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    prisma = app.get(PrismaService);
    automation = app.get(AutomationProcessor, { strict: false });
    delivery = app.get(WebhookDeliveryProcessor, { strict: false });
    box = new SecretBox(process.env.CREDENTIALS_ENCRYPTION_KEY!);
    producer = new Queue(QueueName.WEBHOOK_DELIVERY, {
      connection: { ...app.get(RedisService).connectionOptions },
      prefix: PREFIX,
    });

    const a = await makeOrg('A');
    const b = await makeOrg('B');
    ({ orgId: orgA, userId: userA, leadId: leadA } = a);
    ({ orgId: orgB, userId: userB, leadId: leadB } = b);
  });

  afterAll(async () => {
    if (prisma) {
      await db()
        .notification.deleteMany({ where: { userId: { in: [userA, userB] } } })
        .catch(() => undefined);
      await db()
        .organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
        .catch(() => undefined);
      await db()
        .user.deleteMany({ where: { id: { in: [userA, userB] } } })
        .catch(() => undefined);
    }
    await producer?.close();
    if (app) await app.close();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    for (const q of [QueueName.AUTOMATION, QueueName.WEBHOOK_DELIVERY]) {
      const cleanup = new Queue(q, {
        connection: { ...(app ? app.get(RedisService).connectionOptions : {}) },
        prefix: PREFIX,
      });
      await cleanup.obliterate({ force: true }).catch(() => undefined);
      await cleanup.close();
    }
  });

  beforeEach(() => {
    captured.length = 0;
    serverStatus = 200;
  });

  // ---------------------------------------------------------------------------------------------
  describe('event fan-out and workflow execution', () => {
    it('runs a lead.created workflow: tags the lead, writes a note, notifies, audits', async () => {
      const wf = await createWorkflow(
        orgA,
        'lead-created',
        { type: 'event', event: 'lead.created' },
        [
          {
            id: 's1',
            type: 'update_lead',
            leadId: '{{trigger.payload.lead.id}}',
            addTags: ['auto'],
          },
          {
            id: 's2',
            type: 'create_lead_note',
            leadId: '{{trigger.payload.lead.id}}',
            body: 'Auto note for {{trigger.payload.lead.title}}',
          },
          {
            id: 's3',
            type: 'send_notification',
            to: { kind: 'user', userId: userA },
            title: 'New lead {{trigger.payload.lead.title}}',
          },
        ],
      );
      const outcome = await automation.fanOut(
        eventJob(orgA, 'lead.created', { lead: { id: leadA, title: 'Lead A', assigneeId: userA } }),
      );
      expect(outcome).toMatchObject({ status: 'completed', executions: 1 });

      const [execution] = await executionsOf(wf.id);
      const done = await finished(execution!.id);
      expect(done.status).toBe('succeeded');
      const results = done.stepResults as Array<{ stepId: string; status: string }>;
      expect(results.map((r) => [r.stepId, r.status])).toEqual([
        ['s1', 'succeeded'],
        ['s2', 'succeeded'],
        ['s3', 'succeeded'],
      ]);

      const lead = await db().lead.findUniqueOrThrow({ where: { id: leadA } });
      expect(lead.tags).toContain('auto');
      const notes = await db().leadNote.findMany({ where: { leadId: leadA } });
      expect(notes.map((n) => n.body)).toContain('Auto note for Lead A');
      const notification = await db().notification.findFirst({
        where: { userId: userA, title: 'New lead Lead A' },
      });
      expect(notification).not.toBeNull();

      const audits = await db().auditLog.findMany({
        where: { organizationId: orgA, action: { in: ['workflow.action', 'workflow.executed'] } },
      });
      expect(audits.some((a) => a.action === 'workflow.action')).toBe(true);
      expect(
        audits.some(
          (a) =>
            a.action === 'workflow.executed' &&
            a.targetId === wf.id &&
            (a.metadata as { executionId?: string }).executionId === execution!.id,
        ),
      ).toBe(true);

      const wfAfter = await db().workflow.findUniqueOrThrow({ where: { id: wf.id } });
      expect(wfAfter.runCount).toBe(1);
    });

    it('is idempotent: the same event job never creates a second execution', async () => {
      const wf = await createWorkflow(orgA, 'idem', { type: 'event', event: 'contact.created' }, [
        { id: 's1', type: 'set_variable', name: 'x', value: '1' },
      ]);
      const job = eventJob(orgA, 'contact.created', { contact: { id: randomUUID() } });
      await automation.fanOut(job);
      await automation.fanOut(job);
      const rows = await executionsOf(wf.id);
      expect(rows).toHaveLength(1);
      await finished(rows[0]!.id);
    });

    it('does not run disabled workflows from an event', async () => {
      const wf = await createWorkflow(
        orgA,
        'disabled',
        { type: 'event', event: 'lead.assigned' },
        [{ id: 's1', type: 'set_variable', name: 'x', value: '1' }],
        { isEnabled: false },
      );
      const outcome = await automation.fanOut(
        eventJob(orgA, 'lead.assigned', { lead: { id: leadA } }),
      );
      expect(outcome).toMatchObject({ status: 'completed', executions: 0 });
      expect(await executionsOf(wf.id)).toHaveLength(0);
    });

    it('cancels an already queued execution when its workflow got disabled', async () => {
      const wf = await createWorkflow(
        orgA,
        'disabled-queued',
        { type: 'manual' },
        [{ id: 's1', type: 'create_lead_note', leadId: leadA, body: 'must not be written' }],
        { isEnabled: false },
      );
      const execution = await db().workflowExecution.create({
        data: {
          organizationId: orgA,
          workflowId: wf.id,
          status: 'queued',
          trigger: { type: 'manual' },
          input: {},
        },
      });
      const outcome = await automation.execute({
        kind: 'execute',
        organizationId: orgA,
        workflowId: wf.id,
        executionId: execution.id,
        idempotencyKey: `wf-exec-${execution.id}`,
        ...base(),
      });
      expect(outcome).toMatchObject({ executionStatus: 'cancelled' });
      expect(
        (await db().workflowExecution.findUniqueOrThrow({ where: { id: execution.id } })).status,
      ).toBe('cancelled');
      expect(
        await db().leadNote.count({ where: { leadId: leadA, body: 'must not be written' } }),
      ).toBe(0);
    });

    it('persists a delay, keeps the run in progress and finishes after resume', async () => {
      const wf = await createWorkflow(orgA, 'delay', { type: 'manual' }, [
        { id: 's1', type: 'set_variable', name: 'a', value: 'one' },
        { id: 's2', type: 'delay', seconds: 1 },
        { id: 's3', type: 'create_lead_note', leadId: leadA, body: 'after delay {{vars.a}}' },
      ]);
      const execution = await db().workflowExecution.create({
        data: {
          organizationId: orgA,
          workflowId: wf.id,
          status: 'queued',
          trigger: { type: 'manual' },
          input: {},
        },
      });
      await automation.execute({
        kind: 'execute',
        organizationId: orgA,
        workflowId: wf.id,
        executionId: execution.id,
        idempotencyKey: `wf-exec-${execution.id}`,
        ...base(),
      });
      const mid = await db().workflowExecution.findUniqueOrThrow({ where: { id: execution.id } });
      expect(mid.status).toBe('running');
      expect((mid.stepResults as unknown[]).length).toBe(2);
      expect(await db().leadNote.count({ where: { leadId: leadA, body: 'after delay one' } })).toBe(
        0,
      );

      // The delayed `resume` job is consumed by the real worker.
      const done = await finished(execution.id);
      expect(done.status).toBe('succeeded');
      expect(await db().leadNote.count({ where: { leadId: leadA, body: 'after delay one' } })).toBe(
        1,
      );
    });

    it('blocks http_request steps that target private addresses', async () => {
      const wf = await createWorkflow(orgA, 'ssrf-step', { type: 'manual' }, [
        { id: 's1', type: 'http_request', method: 'GET', url: 'https://10.0.0.5/internal' },
      ]);
      const execution = await db().workflowExecution.create({
        data: {
          organizationId: orgA,
          workflowId: wf.id,
          status: 'queued',
          trigger: { type: 'manual' },
          input: {},
        },
      });
      await automation.execute({
        kind: 'execute',
        organizationId: orgA,
        workflowId: wf.id,
        executionId: execution.id,
        idempotencyKey: `wf-exec-${execution.id}`,
        ...base(),
      });
      const done = await finished(execution.id);
      expect(done.status).toBe('failed');
      const [step] = done.stepResults as Array<{ status: string; error: string }>;
      expect(step!.status).toBe('failed');
      expect(step!.error).toMatch(/private|blocked|not allowed/i);
    });

    it('sends the n8n API key only to the configured origin', async () => {
      await db().integration.create({
        data: {
          organizationId: orgA,
          kind: 'n8n',
          name: `n8n-${randomUUID().slice(0, 6)}`,
          config: { kind: 'n8n', baseUrl: serverUrl, webhookPathPrefix: '/webhook' },
          encryptedSecrets: box.encrypt(JSON.stringify({ apiKey: 'n8n-secret-key' }), orgA),
          status: 'connected',
        },
      });
      // Second local server = a different origin (different port).
      const other: Captured[] = [];
      const otherServer = createServer((req, res) => {
        other.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: '',
        });
        res.end('{}');
      });
      await new Promise<void>((resolve) => otherServer.listen(0, '127.0.0.1', resolve));
      const otherUrl = `http://127.0.0.1:${(otherServer.address() as AddressInfo).port}/hook`;
      try {
        const wf = await createWorkflow(orgA, 'n8n', { type: 'manual' }, [
          { id: 's1', type: 'n8n_trigger', webhook: 'lead-flow', payload: { hello: 'world' } },
          { id: 's2', type: 'n8n_trigger', webhook: otherUrl, payload: {} },
        ]);
        const execution = await db().workflowExecution.create({
          data: {
            organizationId: orgA,
            workflowId: wf.id,
            status: 'queued',
            trigger: { type: 'manual' },
            input: {},
          },
        });
        await automation.execute({
          kind: 'execute',
          organizationId: orgA,
          workflowId: wf.id,
          executionId: execution.id,
          idempotencyKey: `wf-exec-${execution.id}`,
          ...base(),
        });
        const done = await finished(execution.id);
        expect(done.status).toBe('succeeded');
        const own = captured.find((c) => c.url === '/webhook/lead-flow');
        expect(own?.headers['x-n8n-api-key']).toBe('n8n-secret-key');
        expect(JSON.parse(own!.body)).toMatchObject({
          hello: 'world',
          _hilatech: { organizationId: orgA },
        });
        expect(other).toHaveLength(1);
        expect(other[0]!.headers['x-n8n-api-key']).toBeUndefined();
      } finally {
        await new Promise<void>((resolve) => otherServer.close(() => resolve()));
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('schedule tick', () => {
    it('creates executions for due cron minutes and never duplicates them', async () => {
      const now = new Date();
      const wf = await createWorkflow(
        orgA,
        'cron',
        { type: 'schedule', cron: '* * * * *' },
        [{ id: 's1', type: 'set_variable', name: 'x', value: '1' }],
        { updatedAt: new Date(now.getTime() - 60 * 60_000) },
      );
      const first = await automation.tick(now);
      expect(first).toMatchObject({ status: 'completed' });
      const afterFirst = await executionsOf(wf.id);
      expect(afterFirst.length).toBeGreaterThanOrEqual(4);
      expect(afterFirst.every((e) => (e.trigger as { type?: string }).type === 'schedule')).toBe(
        true,
      );

      await automation.tick(now);
      const afterSecond = await executionsOf(wf.id);
      expect(new Set(afterSecond.map((e) => e.id))).toEqual(new Set(afterFirst.map((e) => e.id)));
      await Promise.all(afterSecond.map((e) => finished(e.id)));
    });

    it('does not fire for minutes before the workflow was saved, nor for disabled workflows', async () => {
      const fresh = await createWorkflow(
        orgA,
        'cron-fresh',
        { type: 'schedule', cron: '* * * * *' },
        [{ id: 's1', type: 'set_variable', name: 'x', value: '1' }],
      );
      const off = await createWorkflow(
        orgA,
        'cron-off',
        { type: 'schedule', cron: '* * * * *' },
        [{ id: 's1', type: 'set_variable', name: 'x', value: '1' }],
        { isEnabled: false, updatedAt: new Date(Date.now() - 3600_000) },
      );
      await automation.tick(new Date());
      expect(await executionsOf(fresh.id)).toHaveLength(0);
      expect(await executionsOf(off.id)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('outbound webhook delivery', () => {
    it('delivers a signed payload to a local http server', async () => {
      const hook = await createWebhook(orgA, `${serverUrl}/receive`);
      const row = await createDelivery(orgA, hook.id);
      const done = await attempt(orgA, row.id, 0);

      expect(done.status).toBe('delivered');
      expect(done.attempts).toBe(1);
      expect(done.responseStatus).toBe(200);
      expect(captured).toHaveLength(1);
      const req = captured[0]!;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/receive');
      expect(req.headers['x-hilatech-event']).toBe('lead.created');
      expect(req.headers['x-hilatech-delivery']).toBe(row.id);
      expect(
        verifyOutboundSignature({
          secret: SIGNING_SECRET,
          timestamp: req.headers['x-hilatech-timestamp'] as string,
          body: req.body,
          signature: req.headers['x-hilatech-signature'] as string,
        }),
      ).toBe(true);
      expect(
        verifyOutboundSignature({
          secret: 'wrong-secret',
          timestamp: req.headers['x-hilatech-timestamp'] as string,
          body: req.body,
          signature: req.headers['x-hilatech-signature'] as string,
        }),
      ).toBe(false);
      expect(JSON.parse(req.body)).toMatchObject({
        id: row.id,
        event: 'lead.created',
        organizationId: orgA,
      });
    });

    it('schedules a retry after a 500 and a stale duplicate job does not double-send', async () => {
      serverStatus = 500;
      const hook = await createWebhook(orgA, `${serverUrl}/flaky`);
      const row = await createDelivery(orgA, hook.id);
      const after = await attempt(orgA, row.id, 0);
      expect(after.status).toBe('pending');
      expect(after.attempts).toBe(1);
      expect(after.responseStatus).toBe(500);
      expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 10_000);
      const delayed = await producer.getDelayed();
      expect(delayed.some((j) => j.data?.deliveryId === row.id && j.data?.attempt === 1)).toBe(
        true,
      );

      const count = captured.length;
      const dup = await attempt(orgA, row.id, 1); // not due yet
      expect(dup.attempts).toBe(1);
      expect(captured).toHaveLength(count);
    });

    it('marks the delivery failed after the fifth failed attempt', async () => {
      serverStatus = 503;
      const hook = await createWebhook(orgA, `${serverUrl}/down`);
      const row = await createDelivery(orgA, hook.id, 4);
      const after = await attempt(orgA, row.id, 4);
      expect(after.status).toBe('failed');
      expect(after.attempts).toBe(5);
      expect(after.nextAttemptAt).toBeNull();
      expect(after.lastError).toMatch(/503/);
    });

    it('fails immediately, without a request, for private targets and plain http to non-local hosts', async () => {
      const priv = await createWebhook(orgA, 'https://10.1.2.3/hook');
      const http = await createWebhook(orgA, 'http://203.0.113.9/hook');
      const a = await attempt(orgA, (await createDelivery(orgA, priv.id)).id, 0);
      const b = await attempt(orgA, (await createDelivery(orgA, http.id)).id, 0);
      for (const row of [a, b]) {
        expect(row.status).toBe('failed');
        expect(row.attempts).toBe(1);
        expect(row.lastError).toMatch(/outbound policy/i);
      }
      expect(captured).toHaveLength(0);
    });

    it('fans an event out to the matching subscriptions of the same organization only', async () => {
      const mine = await createWebhook(orgA, `${serverUrl}/mine`, ['member.joined']);
      const theirs = await createWebhook(orgB, `${serverUrl}/theirs`, ['member.joined']);
      const outcome = await automation.fanOut(
        eventJob(orgA, 'member.joined', { member: { id: randomUUID() } }),
      );
      expect(outcome).toMatchObject({ deliveries: 1 });
      expect(await db().webhookDelivery.count({ where: { webhookId: mine.id } })).toBe(1);
      expect(await db().webhookDelivery.count({ where: { webhookId: theirs.id } })).toBe(0);
      // The real worker delivers the created row.
      const row = await waitFor(async () => {
        const r = await db().webhookDelivery.findFirst({ where: { webhookId: mine.id } });
        return r && r.status !== 'pending' ? r : null;
      });
      expect(row.status).toBe('delivered');
    });

    it('a delivery job of another organization is skipped', async () => {
      const hook = await createWebhook(orgA, `${serverUrl}/receive`);
      const row = await createDelivery(orgA, hook.id);
      const before = captured.length;
      await delivery.process(
        {
          data: {
            organizationId: orgB,
            deliveryId: row.id,
            attempt: 0,
            idempotencyKey: 'x',
            ...base(),
          },
        } as never,
        { requestId: 'int', jobId: 'int' } as never,
      );
      expect(captured).toHaveLength(before);
      expect(
        (await db().webhookDelivery.findUniqueOrThrow({ where: { id: row.id } })).attempts,
      ).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('cross-tenant isolation', () => {
    it('a foreign lead id fails the step and leaves the lead untouched', async () => {
      const wf = await createWorkflow(orgA, 'foreign-lead', { type: 'manual' }, [
        { id: 's1', type: 'update_lead', leadId: leadB, addTags: ['pwned'] },
      ]);
      const execution = await db().workflowExecution.create({
        data: {
          organizationId: orgA,
          workflowId: wf.id,
          status: 'queued',
          trigger: { type: 'manual' },
          input: {},
        },
      });
      await automation.execute({
        kind: 'execute',
        organizationId: orgA,
        workflowId: wf.id,
        executionId: execution.id,
        idempotencyKey: `wf-exec-${execution.id}`,
        ...base(),
      });
      const done = await finished(execution.id);
      expect(done.status).toBe('failed');
      expect((await db().lead.findUniqueOrThrow({ where: { id: leadB } })).tags).not.toContain(
        'pwned',
      );
    });

    it('an org A event never triggers an org B workflow', async () => {
      const wf = await createWorkflow(
        orgB,
        'b-only',
        { type: 'event', event: 'conversation.created' },
        [{ id: 's1', type: 'set_variable', name: 'x', value: '1' }],
      );
      await automation.fanOut(
        eventJob(orgA, 'conversation.created', { conversation: { id: randomUUID() } }),
      );
      expect(await executionsOf(wf.id)).toHaveLength(0);
    });

    it('an execute job carrying the wrong organization is skipped', async () => {
      const wf = await createWorkflow(orgA, 'wrong-org', { type: 'manual' }, [
        { id: 's1', type: 'set_variable', name: 'x', value: '1' },
      ]);
      const execution = await db().workflowExecution.create({
        data: {
          organizationId: orgA,
          workflowId: wf.id,
          status: 'queued',
          trigger: { type: 'manual' },
          input: {},
        },
      });
      const outcome = await automation.execute({
        kind: 'execute',
        organizationId: orgB,
        workflowId: wf.id,
        executionId: execution.id,
        idempotencyKey: `wf-exec-wrong-${execution.id}`,
        ...base(),
      });
      expect(outcome).toMatchObject({ status: 'skipped', reason: 'not_found' });
      expect(
        (await db().workflowExecution.findUniqueOrThrow({ where: { id: execution.id } })).status,
      ).toBe('queued');
    });
  });
});

// Keep the shared default job options referenced so a contract change surfaces here too.
void DEFAULT_JOB_OPTIONS;
