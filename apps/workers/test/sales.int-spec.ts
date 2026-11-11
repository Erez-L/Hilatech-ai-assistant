/**
 * Integration: task reminders (`tasks` queue), CSV import execution (`imports` queue) and the `create_task`
 * workflow step, against the real workers application, the test database and Redis. Processors are driven
 * directly (deterministic); everything lives under throw-away organizations removed afterwards (cascade).
 */
import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ALL_PERMISSIONS, QueueName } from '@hilatech/contracts';
import { salesTools } from '@hilatech/ai-engine';
import { createDefaultPipeline } from '@hilatech/database';
import { UTF8_BOM } from '@hilatech/shared';
import { buildObjectKey, type StorageDriver } from '@hilatech/storage';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { AppModule } from '../src/app.module';
import { AutomationProcessor } from '../src/automation/automation.processor';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportsProcessor } from '../src/processors/imports/imports.processor';
import { TasksProcessor, reminderKey } from '../src/processors/tasks/tasks.processor';
import { RedisService } from '../src/redis/redis.service';
import { STORAGE_DRIVER } from '../src/storage/storage.module';

const PREFIX = process.env.BULLMQ_PREFIX!;

describe('tasks, imports and create_task (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let tasks: TasksProcessor;
  let imports: ImportsProcessor;
  let automation: AutomationProcessor;
  let storage: StorageDriver;
  const db = () => prisma.client;

  const orgs: string[] = [];
  const users: string[] = [];
  let orgA: string;
  let orgB: string;
  let userA: string;
  let userA2: string;
  let userB: string;
  let emailA: string;

  const makeOrg = async (label: string) => {
    const email = `sales-int-${label}-${randomUUID()}@test.local`;
    const user = await db().user.create({
      data: { email, passwordHash: 'x', firstName: label, lastName: 'Sales' },
      select: { id: true },
    });
    const org = await db().organization.create({
      data: {
        name: `Sales Int ${label}`,
        slug: `sales-int-${label}-${randomUUID().slice(0, 8)}`,
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
    await createDefaultPipeline(db(), org.id);
    orgs.push(org.id);
    users.push(user.id);
    return { orgId: org.id, userId: user.id, email, roleId: org.roles[0]!.id };
  };

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toMatch(/_test(\w*)(\?|$)/);
    expect(process.env.TASK_REMINDER_SCHEDULER_ENABLED).toBe('false');
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    prisma = app.get(PrismaService);
    tasks = app.get(TasksProcessor, { strict: false });
    imports = app.get(ImportsProcessor, { strict: false });
    automation = app.get(AutomationProcessor, { strict: false });
    storage = app.get<StorageDriver>(STORAGE_DRIVER, { strict: false });
    const a = await makeOrg('A');
    const b = await makeOrg('B');
    ({ orgId: orgA, userId: userA, email: emailA } = a);
    ({ orgId: orgB, userId: userB } = b);
    const second = await db().user.create({
      data: {
        email: `sales-int-a2-${randomUUID()}@test.local`,
        passwordHash: 'x',
        firstName: 'A2',
        lastName: 'Sales',
      },
      select: { id: true },
    });
    userA2 = second.id;
    users.push(userA2);
    await db().organizationMember.create({
      data: { organizationId: orgA, userId: userA2, roleId: a.roleId, status: 'active' },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await db()
        .notification.deleteMany({ where: { userId: { in: users } } })
        .catch(() => undefined);
      await db()
        .organization.deleteMany({ where: { id: { in: orgs } } })
        .catch(() => undefined);
      await db()
        .user.deleteMany({ where: { id: { in: users } } })
        .catch(() => undefined);
    }
    for (const q of [QueueName.TASKS, QueueName.IMPORTS, QueueName.AUTOMATION]) {
      const cleanup = new Queue(q, {
        connection: { ...(app ? app.get(RedisService).connectionOptions : {}) },
        prefix: PREFIX,
      });
      await cleanup.obliterate({ force: true }).catch(() => undefined);
      await cleanup.close();
    }
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------------------------
  describe('task reminders', () => {
    const NOW = new Date('2030-06-01T12:00:00Z');
    const past = new Date('2030-06-01T11:00:00Z');
    const mk = (organizationId: string, data: Record<string, unknown>) =>
      db().task.create({
        data: { organizationId, title: `T-${randomUUID().slice(0, 6)}`, ...data } as never,
      });
    const reminders = (userId: string) =>
      db().notification.findMany({
        where: { userId, type: 'task_reminder' },
        orderBy: { createdAt: 'asc' },
      });

    it('notifies the assignee once, claims the task, and a second tick does nothing', async () => {
      const t = await mk(orgA, {
        title: 'Call Dana',
        assigneeId: userA,
        reminderAt: past,
        dueAt: new Date('2030-06-01T13:00:00Z'),
      });
      const first = await tasks.reminderTick(NOW, orgA);
      expect(first).toMatchObject({ notified: 1 });
      const notes = await reminders(userA);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ organizationId: orgA, title: 'Call Dana', link: '/tasks' });
      expect(notes[0]!.data).toMatchObject({
        taskId: t.id,
        idempotencyKey: reminderKey(t.id, past),
      });
      expect(
        (await db().task.findUniqueOrThrow({ where: { id: t.id } })).reminderSentAt,
      ).not.toBeNull();
      expect(await tasks.reminderTick(NOW, orgA)).toMatchObject({ scanned: 0, notified: 0 });
      expect(await reminders(userA)).toHaveLength(1);
    });

    it('is idempotent even if the claim was lost (marker cleared) - the notification key prevents a duplicate', async () => {
      const t = await mk(orgA, { assigneeId: userA2, reminderAt: past });
      await tasks.reminderTick(NOW, orgA);
      expect(await reminders(userA2)).toHaveLength(1);
      await db().task.update({ where: { id: t.id }, data: { reminderSentAt: null } });
      const again = await tasks.reminderTick(NOW, orgA);
      expect(again.notified).toBe(0);
      expect(await reminders(userA2)).toHaveLength(1);
    });

    it('concurrent ticks deliver exactly one reminder', async () => {
      const t = await mk(orgA, { title: 'Race', assigneeId: userA, reminderAt: past });
      const before = (await reminders(userA)).length;
      const results = await Promise.all([
        tasks.reminderTick(NOW, orgA),
        tasks.reminderTick(NOW, orgA),
        tasks.reminderTick(NOW, orgA),
      ]);
      expect(results.reduce((n, r) => n + r.notified, 0)).toBe(1);
      expect((await reminders(userA)).length).toBe(before + 1);
      expect(
        await db().notification.count({ where: { data: { path: ['taskId'], equals: t.id } } }),
      ).toBe(1);
    });

    it('skips future, finished and cancelled reminders; changed reminderAt fires again', async () => {
      const future = await mk(orgA, {
        assigneeId: userA,
        reminderAt: new Date('2030-06-02T00:00:00Z'),
      });
      const done = await mk(orgA, { assigneeId: userA, reminderAt: past, status: 'done' });
      const cancelled = await mk(orgA, {
        assigneeId: userA,
        reminderAt: past,
        status: 'cancelled',
      });
      await tasks.reminderTick(NOW, orgA);
      for (const t of [future, done, cancelled]) {
        expect(
          await db().notification.count({ where: { data: { path: ['taskId'], equals: t.id } } }),
        ).toBe(0);
      }
      // later tick reaches the future reminder
      await tasks.reminderTick(new Date('2030-06-02T01:00:00Z'), orgA);
      expect(
        await db().notification.count({ where: { data: { path: ['taskId'], equals: future.id } } }),
      ).toBe(1);
      // reminderAt moved (API clears the marker): a new key is generated, so it fires again
      await db().task.update({
        where: { id: future.id },
        data: { reminderAt: new Date('2030-06-03T00:00:00Z'), reminderSentAt: null },
      });
      await tasks.reminderTick(new Date('2030-06-03T01:00:00Z'), orgA);
      expect(
        await db().notification.count({ where: { data: { path: ['taskId'], equals: future.id } } }),
      ).toBe(2);
    });

    it('reminds the creator when unassigned; skips tasks without a valid recipient; honours preferences', async () => {
      const unassigned = await mk(orgA, { createdById: userA2, reminderAt: past });
      const nobody = await mk(orgA, { reminderAt: past });
      const inactive = await db().user.create({
        data: {
          email: `inactive-${randomUUID()}@test.local`,
          passwordHash: 'x',
          firstName: 'I',
          lastName: 'x',
          isActive: false,
        },
        select: { id: true },
      });
      users.push(inactive.id);
      const role = await db().role.findFirstOrThrow({
        where: { organizationId: orgA, key: 'owner' },
      });
      await db().organizationMember.create({
        data: { organizationId: orgA, userId: inactive.id, roleId: role.id, status: 'active' },
      });
      const toInactive = await mk(orgA, { assigneeId: inactive.id, reminderAt: past });
      await db().user.update({
        where: { id: userA2 },
        data: { preferences: { notifications: { inApp: { task_reminder: false } } } },
      });
      const muted = await mk(orgA, { assigneeId: userA2, reminderAt: past });
      await tasks.reminderTick(NOW, orgA);
      const count = (id: string) =>
        db().notification.count({ where: { data: { path: ['taskId'], equals: id } } });
      expect(await count(unassigned.id)).toBe(0); // creator userA2 has muted reminders
      await db().user.update({ where: { id: userA2 }, data: { preferences: {} } });
      expect(await count(nobody.id)).toBe(0);
      expect(await count(toInactive.id)).toBe(0);
      expect(await count(muted.id)).toBe(0);
      await db().task.update({ where: { id: unassigned.id }, data: { reminderSentAt: null } });
      await tasks.reminderTick(NOW, orgA);
      expect(await count(unassigned.id)).toBe(1);
    });

    it('is tenant-scoped: an org-filtered tick never touches another organization', async () => {
      const t = await mk(orgB, { assigneeId: userB, reminderAt: past });
      await tasks.reminderTick(NOW, orgA);
      expect(
        (await db().task.findUniqueOrThrow({ where: { id: t.id } })).reminderSentAt,
      ).toBeNull();
      await tasks.reminderTick(NOW, null);
      expect(
        await db().notification.count({
          where: { userId: userB, type: 'task_reminder', organizationId: orgB },
        }),
      ).toBe(1);
    });

    it('process() validates the queue payload kind and returns a summary', async () => {
      const out = await tasks.process(
        {
          data: {
            kind: 'reminder_tick',
            organizationId: orgA,
            at: NOW.toISOString(),
            idempotencyKey: 'task-reminder-tick',
            enqueuedAt: NOW.toISOString(),
          },
        } as never,
        {} as never,
      );
      expect(out).toMatchObject({ status: 'completed', kind: 'reminder_tick' });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('CSV import execution', () => {
    const upload = async (organizationId: string, csv: string | Buffer, name = 'import.csv') => {
      const buffer = Buffer.isBuffer(csv) ? csv : Buffer.from(csv, 'utf8');
      const key = buildObjectKey(organizationId, 'imports', name);
      await storage.put({ key, body: buffer, contentType: 'text/csv' });
      return key;
    };
    const makeJob = async (
      organizationId: string,
      createdById: string,
      entity: 'contacts' | 'leads' | 'companies' | 'deals',
      csv: string | Buffer,
      mapping: Record<string, number | null>,
      strategy: 'skip' | 'update' | 'create' = 'skip',
      extra: Record<string, unknown> = {},
    ) => {
      const key = await upload(organizationId, csv);
      const text = Buffer.isBuffer(csv) ? '' : csv;
      const lines = text
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter(Boolean);
      return db().importJob.create({
        data: {
          organizationId,
          entity,
          status: 'queued',
          fileName: 'import.csv',
          sizeBytes: Buffer.byteLength(text),
          storageKey: key,
          encoding: 'utf-8',
          delimiter: ',',
          headers: (lines[0] ?? '').split(','),
          totalRows: Math.max(0, lines.length - 1),
          mapping,
          duplicateStrategy: strategy,
          createdById,
          ...extra,
        } as never,
      });
    };

    it('imports a Hebrew BOM file: creates, skips duplicates (file + existing), fails invalid rows with reasons', async () => {
      await db().contact.create({
        data: { organizationId: orgA, firstName: 'Existing', email: 'old@example.com' },
      });
      const csv =
        `${UTF8_BOM}שם פרטי,שם משפחה,אימייל,טלפון,תגיות\r\n` +
        `דנה,כהן,dana@example.com,050-1234567,vip;חם\r\n` +
        `דנה שוב,כהן,DANA@example.com,,\r\n` +
        `,ללא שם,x@example.com,,\r\n` +
        `ישן,אדם,old@example.com,,\r\n` +
        `יוסי,לוי,,052-7654321,\r\n`;
      const job = await makeJob(orgA, userA, 'contacts', csv, {
        firstName: 0,
        lastName: 1,
        email: 2,
        phone: 3,
        tags: 4,
      });
      const outcome = await imports.run(orgA, job.id);
      expect(outcome).toMatchObject({
        status: 'completed',
        created: 2,
        updated: 0,
        skipped: 2,
        failed: 1,
      });
      const row = await db().importJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(row).toMatchObject({
        status: 'completed',
        processedRows: 5,
        createdCount: 2,
        skippedCount: 2,
        failedCount: 1,
      });
      expect(row.finishedAt).not.toBeNull();
      const report = row.report as Array<{ row: number; status: string; reason: string }>;
      expect(report.map((r) => [r.row, r.status]).sort()).toEqual([
        [2, 'skipped'],
        [3, 'failed'],
        [4, 'skipped'],
      ]);
      expect(report.find((r) => r.row === 3)!.reason).toMatch(/Required|first/i);
      const dana = await db().contact.findFirstOrThrow({
        where: { organizationId: orgA, email: 'dana@example.com' },
      });
      expect(dana).toMatchObject({
        firstName: 'דנה',
        lastName: 'כהן',
        tags: ['vip', 'חם'],
        phone: '050-1234567',
      });
      expect(
        await db().contact.count({ where: { organizationId: orgA, email: 'old@example.com' } }),
      ).toBe(1);
      expect(
        await db().auditLog.count({
          where: { organizationId: orgA, action: 'import.completed', targetId: job.id },
        }),
      ).toBe(1);
    });

    it('is idempotent: re-running a finished import (or a redelivered job) changes nothing', async () => {
      const job = await makeJob(orgA, userA, 'companies', 'name,domain\nAcme,acme.io\n', {
        name: 0,
        domain: 1,
      });
      expect(await imports.run(orgA, job.id)).toMatchObject({ status: 'completed', created: 1 });
      expect(await imports.run(orgA, job.id)).toMatchObject({
        status: 'skipped',
        reason: 'not_runnable',
      });
      expect(await db().company.count({ where: { organizationId: orgA, name: 'Acme' } })).toBe(1);
      // a redelivery while "running" resumes from the checkpoint instead of starting over
      const resumed = await makeJob(
        orgA,
        userA,
        'companies',
        'name\nR1\nR2\nR3\n',
        { name: 0 },
        'skip',
        {
          status: 'running',
          processedRows: 2,
          createdCount: 2,
        },
      );
      await db().company.createMany({
        data: [
          { organizationId: orgA, name: 'R1' },
          { organizationId: orgA, name: 'R2' },
        ],
      });
      expect(await imports.run(orgA, resumed.id)).toMatchObject({
        status: 'completed',
        created: 3,
      });
      expect(
        await db().company.count({
          where: { organizationId: orgA, name: { in: ['R1', 'R2', 'R3'] } },
        }),
      ).toBe(3);
    });

    it('update strategy updates existing contacts and reports counts; create strategy duplicates on purpose', async () => {
      await db().contact.create({
        data: {
          organizationId: orgA,
          firstName: 'Old',
          email: 'upd@example.com',
          company: 'Before',
        },
      });
      const csv = 'first,email,company\nNew Name,upd@example.com,After\n';
      const upd = await makeJob(
        orgA,
        userA,
        'contacts',
        csv,
        { firstName: 0, email: 1, company: 2 },
        'update',
      );
      expect(await imports.run(orgA, upd.id)).toMatchObject({ created: 0, updated: 1 });
      expect(
        await db().contact.findFirstOrThrow({
          where: { organizationId: orgA, email: 'upd@example.com' },
        }),
      ).toMatchObject({ firstName: 'New Name', company: 'After' });
      const cre = await makeJob(
        orgA,
        userA,
        'contacts',
        csv,
        { firstName: 0, email: 1, company: 2 },
        'create',
      );
      expect(await imports.run(orgA, cre.id)).toMatchObject({ created: 1 });
      expect(
        await db().contact.count({ where: { organizationId: orgA, email: 'upd@example.com' } }),
      ).toBe(2);
    });

    it('is tenant-safe: duplicates are detected per organization, references resolve only inside it, foreign jobs are not found', async () => {
      const other = await db().contact.create({
        data: {
          organizationId: orgB,
          firstName: 'Bee',
          email: 'shared@example.com',
          company: 'B-only',
        },
      });
      const csv = 'first,email,owner\nShared,shared@example.com,' + `${emailA}\n`;
      const job = await makeJob(
        orgA,
        userA,
        'contacts',
        csv,
        { firstName: 0, email: 1, ownerEmail: 2 },
        'update',
      );
      expect(await imports.run(orgA, job.id)).toMatchObject({ created: 1, updated: 0 });
      expect(await db().contact.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({
        firstName: 'Bee',
        company: 'B-only',
      });
      // an owner e-mail of ANOTHER organization member is not resolved
      const bEmail = (await db().user.findUniqueOrThrow({ where: { id: userB } })).email;
      const foreignOwner = await makeJob(
        orgA,
        userA,
        'contacts',
        `first,email,owner\nF,f@example.com,${bEmail}\n`,
        { firstName: 0, email: 1, ownerEmail: 2 },
      );
      expect(await imports.run(orgA, foreignOwner.id)).toMatchObject({ created: 0, failed: 1 });
      expect(await db().contact.count({ where: { email: 'f@example.com' } })).toBe(0);
      // the processor refuses to run a job under another organization id
      const mine = await makeJob(orgA, userA, 'companies', 'name\nMine\n', { name: 0 });
      expect(await imports.run(orgB, mine.id)).toMatchObject({
        status: 'skipped',
        reason: 'not_found',
      });
      expect((await db().importJob.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe(
        'queued',
      );
    });

    it('imports leads (contact by email) and deals (pipeline/stage names, company, closed stages)', async () => {
      await db().contact.create({
        data: { organizationId: orgA, firstName: 'Linked', email: 'linked@example.com' },
      });
      await db().company.create({ data: { organizationId: orgA, name: 'Linked Co' } });
      const leads = await makeJob(
        orgA,
        userA,
        'leads',
        'title,status,value,currency,email\nBig lead,qualified,"1,500.50",₪,linked@example.com\nBad,nonsense,,,\n',
        { title: 0, status: 1, value: 2, currency: 3, contactEmail: 4 },
      );
      expect(await imports.run(orgA, leads.id)).toMatchObject({ created: 1, failed: 1 });
      const lead = await db().lead.findFirstOrThrow({
        where: { organizationId: orgA, title: 'Big lead' },
        include: { contact: true },
      });
      expect(lead).toMatchObject({ status: 'qualified', currency: 'ILS', source: 'import' });
      expect(Number(lead.value)).toBe(1500.5);
      expect(lead.contact?.email).toBe('linked@example.com');

      const deals = await makeJob(
        orgA,
        userA,
        'deals',
        'title,value,stage,company,email,reason\nOpen deal,100,Qualified,Linked Co,linked@example.com,\nWon deal,200,Won,,,\nLost deal,300,Lost,,,Too pricey\nBad stage,1,Nowhere,,,\n',
        { title: 0, value: 1, stage: 2, companyName: 3, contactEmail: 4, lostReason: 5 },
      );
      expect(await imports.run(orgA, deals.id)).toMatchObject({ created: 3, failed: 1 });
      const rows = await db().deal.findMany({
        where: { organizationId: orgA },
        include: { stage: true, company: true, contact: true },
        orderBy: { title: 'asc' },
      });
      const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
      expect(byTitle['Open deal']).toMatchObject({
        status: 'open',
        stage: { name: 'Qualified' },
        company: { name: 'Linked Co' },
        contact: { email: 'linked@example.com' },
      });
      expect(byTitle['Won deal']).toMatchObject({ status: 'won' });
      expect(byTitle['Won deal']!.closedAt).not.toBeNull();
      expect(byTitle['Lost deal']).toMatchObject({ status: 'lost', lostReason: 'Too pricey' });
      expect(await db().dealStageChange.count({ where: { organizationId: orgA } })).toBe(3);
      const positions = rows
        .filter((r) => r.stageId === byTitle['Open deal']!.stageId)
        .map((r) => r.position);
      expect(positions).toEqual([0]);
    });

    it('processes large files in batches with progress, and a cancelled job stops without writing', async () => {
      const big =
        ['name', ...Array.from({ length: 450 }, (_, i) => `Bulk Co ${i}`)].join('\n') + '\n';
      const job = await makeJob(orgA, userA, 'companies', big, { name: 0 });
      expect(await imports.run(orgA, job.id)).toMatchObject({ status: 'completed', created: 450 });
      expect(
        await db().company.count({
          where: { organizationId: orgA, name: { startsWith: 'Bulk Co ' } },
        }),
      ).toBe(450);
      expect(
        (await db().importJob.findUniqueOrThrow({ where: { id: job.id } })).processedRows,
      ).toBe(450);

      const cancelled = await makeJob(
        orgA,
        userA,
        'companies',
        'name\nShould not exist\n',
        { name: 0 },
        'skip',
        { status: 'cancelled' },
      );
      expect(await imports.run(orgA, cancelled.id)).toMatchObject({
        status: 'skipped',
        reason: 'not_runnable',
      });
      expect(await db().company.count({ where: { name: 'Should not exist' } })).toBe(0);
    });

    it('fails the job with a readable error when the stored file is missing or the mapping is absent', async () => {
      const missing = await db().importJob.create({
        data: {
          organizationId: orgA,
          entity: 'contacts',
          status: 'queued',
          fileName: 'x.csv',
          sizeBytes: 1,
          storageKey: `org/${orgA}/imports/2030/01/${randomUUID()}.csv`,
          headers: ['a'],
          totalRows: 1,
          mapping: { firstName: 0 },
          createdById: userA,
        },
      });
      await imports.run(orgA, missing.id);
      expect(await db().importJob.findUniqueOrThrow({ where: { id: missing.id } })).toMatchObject({
        status: 'failed',
      });
      const noMap = await makeJob(orgA, userA, 'contacts', 'a\nb\n', {});
      await db().importJob.update({ where: { id: noMap.id }, data: { mapping: undefined } });
      await db().$executeRaw`UPDATE "ImportJob" SET "mapping" = NULL WHERE id = ${noMap.id}::uuid`;
      await imports.run(orgA, noMap.id);
      expect(await db().importJob.findUniqueOrThrow({ where: { id: noMap.id } })).toMatchObject({
        status: 'failed',
        error: expect.stringMatching(/mapping/i),
      });
    });

    it('decodes Windows-1255 files', async () => {
      // "שם\nדנה" with header "first" (cp1255 bytes for the Hebrew name)
      const body = Buffer.concat([
        Buffer.from('first\n'),
        Buffer.from([0xe3, 0xe4, 0xe0]),
        Buffer.from('\n'),
      ]);
      const job = await makeJob(orgA, userA, 'contacts', body, { firstName: 0 });
      await db().importJob.update({ where: { id: job.id }, data: { totalRows: 1 } });
      expect(await imports.run(orgA, job.id)).toMatchObject({ created: 1 });
      expect(await db().contact.count({ where: { organizationId: orgA, firstName: 'דהא' } })).toBe(
        1,
      );
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('create_task workflow step', () => {
    const run = async (
      organizationId: string,
      steps: Record<string, unknown>[],
      payload: Record<string, unknown> = {},
    ) => {
      const wf = await db().workflow.create({
        data: {
          organizationId,
          name: `ct-${randomUUID().slice(0, 6)}`,
          isEnabled: true,
          trigger: { type: 'manual' } as never,
          steps: steps as never,
        },
      });
      const execution = await db().workflowExecution.create({
        data: {
          organizationId,
          workflowId: wf.id,
          status: 'queued',
          trigger: { type: 'manual', payload } as never,
          input: payload as never,
        },
      });
      const data = {
        kind: 'execute' as const,
        organizationId,
        workflowId: wf.id,
        executionId: execution.id,
        idempotencyKey: `wf-exec-${execution.id}`,
        enqueuedAt: new Date().toISOString(),
      };
      await automation.execute(data);
      return {
        wf,
        execution: await db().workflowExecution.findUniqueOrThrow({ where: { id: execution.id } }),
        data,
      };
    };

    it('creates an automation task with due date, reminder, assignee and related lead from the trigger payload', async () => {
      const lead = await db().lead.create({
        data: { organizationId: orgA, title: 'Task lead', assigneeId: userA2 },
      });
      const { execution } = await run(
        orgA,
        [
          {
            id: 't1',
            type: 'create_task',
            title: 'Follow up {{trigger.payload.name}}',
            description: 'Call back',
            priority: 'high',
            assignee: { kind: 'assignee' },
            dueInHours: 24,
            reminderBeforeHours: 2,
          },
        ],
        { leadId: lead.id, name: 'Dana' },
      );
      expect(execution.status).toBe('succeeded');
      const task = await db().task.findFirstOrThrow({
        where: { organizationId: orgA, title: 'Follow up Dana' },
      });
      expect(task).toMatchObject({
        source: 'automation',
        priority: 'high',
        assigneeId: userA2,
        leadId: lead.id,
        status: 'todo',
      });
      expect(task.dueAt!.getTime() - task.createdAt.getTime()).toBeGreaterThan(23.9 * 3_600_000);
      expect(task.dueAt!.getTime() - task.reminderAt!.getTime()).toBe(2 * 3_600_000);
      expect(
        await db().auditLog.count({
          where: { organizationId: orgA, targetType: 'task', targetId: task.id },
        }),
      ).toBe(1);
      expect(
        await db().notification.count({
          where: {
            userId: userA2,
            type: 'task_assigned',
            data: { path: ['taskId'], equals: task.id },
          },
        }),
      ).toBe(1);
    });

    it('is idempotent per execution/step: re-running the step creates no second task', async () => {
      const { execution, data } = await run(orgA, [
        { id: 'once', type: 'create_task', title: 'Only once' },
      ]);
      expect(execution.status).toBe('succeeded');
      await db().workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'queued', stepResults: [] },
      });
      await automation.execute(data);
      expect(await db().task.count({ where: { organizationId: orgA, title: 'Only once' } })).toBe(
        1,
      );
    });

    it('rejects assignees and related ids of another organization (step fails, nothing created)', async () => {
      const foreignLead = await db().lead.create({
        data: { organizationId: orgB, title: 'Foreign lead' },
      });
      const a = await run(orgA, [
        {
          id: 'f1',
          type: 'create_task',
          title: 'Foreign assignee',
          assignee: { kind: 'user', userId: userB },
        },
      ]);
      expect(a.execution.status).toBe('failed');
      const b = await run(orgA, [
        { id: 'f2', type: 'create_task', title: 'Foreign lead ref', leadId: foreignLead.id },
      ]);
      expect(b.execution.status).toBe('failed');
      // a foreign id arriving only through the trigger payload is ignored (not attached), the task is still created
      const c = await run(
        orgA,
        [{ id: 'f3', type: 'create_task', title: 'Payload foreign lead' }],
        { leadId: foreignLead.id },
      );
      expect(c.execution.status).toBe('succeeded');
      expect(
        await db().task.findFirstOrThrow({
          where: { organizationId: orgA, title: 'Payload foreign lead' },
        }),
      ).toMatchObject({ leadId: null });
      expect(
        await db().task.count({
          where: { title: { in: ['Foreign assignee', 'Foreign lead ref'] } },
        }),
      ).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('engine tools (tasks.* / deals.*)', () => {
    const tool = (key: string) => salesTools.find((t) => t.key === key)!;
    const ctxFor = (organizationId: string, userId: string | null) =>
      ({
        organizationId,
        userId,
        agentId: null,
        executionId: null,
        prisma: db(),
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        signal: new AbortController().signal,
        now: () => new Date(),
      }) as never;
    const call = (
      key: string,
      orgId: string,
      userId: string | null,
      input: Record<string, unknown>,
    ) => {
      const t = tool(key);
      return t.execute(ctxFor(orgId, userId), t.input.parse(input));
    };

    it('registers read vs write risk levels and the permissions they need', () => {
      expect(salesTools.map((t) => [t.key, t.riskLevel, t.requiredPermission])).toEqual([
        ['tasks.list', 'read', 'tasks:read'],
        ['tasks.create', 'write', 'tasks:create'],
        ['deals.list', 'read', 'deals:read'],
        ['deals.create', 'write', 'deals:create'],
        ['deals.move', 'write', 'deals:update'],
      ]);
    });

    it('tasks.create: source ai, assigned to the acting user, validated references; tasks.list is org-scoped', async () => {
      const lead = await db().lead.create({ data: { organizationId: orgA, title: 'Engine lead' } });
      const res = await call('tasks.create', orgA, userA, {
        title: 'AI follow-up',
        leadId: lead.id,
        dueAt: '2031-01-01T00:00:00.000Z',
      });
      expect(res.ok).toBe(true);
      const task = await db().task.findFirstOrThrow({
        where: { organizationId: orgA, title: 'AI follow-up' },
      });
      expect(task).toMatchObject({
        source: 'ai',
        assigneeId: userA,
        createdById: userA,
        leadId: lead.id,
      });

      const foreign = await db().lead.create({
        data: { organizationId: orgB, title: 'Foreign engine lead' },
      });
      const bad = await call('tasks.create', orgA, userA, { title: 'bad', leadId: foreign.id });
      expect(bad).toMatchObject({ ok: false, error: 'invalid_reference' });
      const badAssignee = await call('tasks.create', orgA, userA, {
        title: 'bad2',
        assigneeId: userB,
      });
      expect(badAssignee.ok).toBe(false);
      expect(await db().task.count({ where: { title: { in: ['bad', 'bad2'] } } })).toBe(0);

      await db().task.create({ data: { organizationId: orgB, title: 'B only task' } });
      const list = await call('tasks.list', orgA, userA, { assigneeId: 'me' });
      expect(list.ok).toBe(true);
      const titles = (list.data as Array<{ title: string }>).map((t) => t.title);
      expect(titles).toContain('AI follow-up');
      expect(titles).not.toContain('B only task');
      expect((await call('tasks.list', orgA, null, { assigneeId: 'me' })).error).toBe('no_actor');
    });

    it('tasks.create needs tasks:assign to give a task to someone else', async () => {
      const memberRole = await db().role.create({
        data: {
          organizationId: orgA,
          key: 'limited',
          name: 'Limited',
          permissions: ['tasks:create'],
        },
      });
      await db().organizationMember.update({
        where: { organizationId_userId: { organizationId: orgA, userId: userA2 } },
        data: { roleId: memberRole.id },
      });
      const denied = await call('tasks.create', orgA, userA2, {
        title: 'for someone',
        assigneeId: userA,
      });
      expect(denied).toMatchObject({ ok: false, error: 'forbidden' });
      const self = await call('tasks.create', orgA, userA2, { title: 'for myself' });
      expect(self.ok).toBe(true);
    });

    it('deals.create / deals.list / deals.move work on the default pipeline, close deals and stay in the organization', async () => {
      const created = await call('deals.create', orgA, userA, {
        title: 'AI deal',
        value: 4200,
        currency: 'ils',
        tags: ['ai'],
      });
      expect(created.ok).toBe(true);
      const deal = created.data as { id: string; stage: { name: string }; ownerId: string };
      expect(deal.stage.name).toBe('Lead');
      expect(deal.ownerId).toBe(userA);

      const moved = await call('deals.move', orgA, userA, {
        dealId: deal.id,
        stageName: 'qualified',
      });
      expect(moved.ok).toBe(true);
      expect((moved.data as { stage: { name: string } }).stage.name).toBe('Qualified');
      const lost = await call('deals.move', orgA, userA, {
        dealId: deal.id,
        stageName: 'Lost',
        lostReason: 'No budget',
      });
      expect(lost.data).toMatchObject({ status: 'lost', lostReason: 'No budget' });
      expect(await db().dealStageChange.count({ where: { dealId: deal.id } })).toBe(3);
      expect(
        await db().dealActivity.count({
          where: { dealId: deal.id, payload: { path: ['by'], equals: 'ai' } },
        }),
      ).toBeGreaterThanOrEqual(2);

      const list = await call('deals.list', orgA, userA, { status: 'lost', search: 'AI' });
      expect((list.data as Array<{ id: string }>).map((d) => d.id)).toEqual([deal.id]);

      const bDeal = (await call('deals.create', orgB, userB, { title: 'B deal' })).data as {
        id: string;
      };
      expect(
        await call('deals.move', orgA, userA, { dealId: bDeal.id, stageName: 'Won' }),
      ).toMatchObject({ ok: false, error: 'not_found' });
      expect(
        (await call('deals.move', orgA, userA, { dealId: deal.id, stageName: 'Nope' })).ok,
      ).toBe(false);
      const foreignContact = await db().contact.create({
        data: { organizationId: orgB, firstName: 'Foreign' },
      });
      expect(
        await call('deals.create', orgA, userA, { title: 'x', contactId: foreignContact.id }),
      ).toMatchObject({ ok: false, error: 'invalid_reference' });
      expect((await call('deals.list', orgA, userA, {})).data).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: bDeal.id })]),
      );
    });
  });
});
