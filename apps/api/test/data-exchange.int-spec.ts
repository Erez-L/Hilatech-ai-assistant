import {
  AuditAction,
  type ImportJob,
  type ImportUploadResult,
  QueueName,
  type Role,
} from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  jobsOn,
  register,
  resetDatabase,
} from './setup/test-app';

const BOM = '﻿';

describe('CSV import / export', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgId: string;
  const api = (actor: Actor = owner) => as(ctx, actor, orgId);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    orgId = (await createOrganization(ctx, owner, 'Data Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  function upload(actor: Actor, entity: string, csv: string | Buffer, fileName = 'import.csv') {
    const buffer = Buffer.isBuffer(csv) ? csv : Buffer.from(csv, 'utf8');
    return api(actor)
      .post('/api/v1/imports')
      .field('entity', entity)
      .attach('file', buffer, { filename: fileName, contentType: 'text/csv' });
  }

  async function resetJobs() {
    await ctx.prisma.client.importJob.deleteMany({ where: { organizationId: orgId } });
  }

  describe('upload', () => {
    afterEach(resetJobs);

    it('parses a Hebrew UTF-8 BOM file, detects encoding/delimiter and suggests a mapping', async () => {
      const csv = `${BOM}שם פרטי;שם משפחה;אימייל;טלפון\r\nדנה;כהן;dana@example.com;050-1234567\r\nיוסי;לוי;;052-7654321\r\n`;
      const res = await upload(owner, 'contacts', csv, 'אנשי קשר.csv');
      expect(res.status).toBe(201);
      const job = res.body.data as ImportUploadResult;
      expect(job).toMatchObject({
        organizationId: orgId,
        entity: 'contacts',
        status: 'uploaded',
        fileName: 'אנשי קשר.csv',
        encoding: 'utf-8-bom',
        delimiter: ';',
        totalRows: 2,
        headers: ['שם פרטי', 'שם משפחה', 'אימייל', 'טלפון'],
        suggestedMapping: { firstName: 0, lastName: 1, email: 2, phone: 3 },
        progress: { processed: 0, total: 2, percent: 0 },
      });
      expect(job.sampleRows[0]).toEqual(['דנה', 'כהן', 'dana@example.com', '050-1234567']);
      expect(job.fields.length).toBeGreaterThan(3);
      expect(
        await ctx.prisma.client.auditLog.count({
          where: { organizationId: orgId, action: AuditAction.IMPORT_UPLOADED, targetId: job.id },
        }),
      ).toBe(1);
    });

    it('decodes Windows-1255 files (Excel in Hebrew locales)', async () => {
      // "שם,אימייל\nדנה,d@x.co" in cp1255
      const header = Buffer.from([0xf9, 0xed, 0x2c, 0xe0, 0xe9, 0xee, 0xe9, 0xe9, 0xec, 0x0a]);
      const row = Buffer.concat([Buffer.from([0xe3, 0xe4, 0xe0, 0x2c]), Buffer.from('d@x.co\n')]);
      const res = await upload(owner, 'contacts', Buffer.concat([header, row]));
      expect(res.status).toBe(201);
      expect(res.body.data.encoding).toBe('windows-1255');
      expect(res.body.data.headers).toEqual(['שם', 'אימייל']);
      expect(res.body.data.sampleRows[0]).toEqual(['דהא', 'd@x.co']);
    });

    it('rejects empty files, header-only files, wrong types, binary content and a missing file/entity', async () => {
      expect((await upload(owner, 'contacts', '')).status).toBe(400);
      expect((await upload(owner, 'contacts', 'a,b\n')).status).toBe(400);
      expect((await upload(owner, 'contacts', 'a,b\n1,2', 'data.pdf')).status).toBe(415);
      expect(
        (await upload(owner, 'contacts', Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0x00, 0x01, 0x02])))
          .status,
      ).toBe(415);
      expect((await upload(owner, 'bogus', 'a\n1')).status).toBe(400);
      expect((await api().post('/api/v1/imports').field('entity', 'contacts')).status).toBe(400);
      expect((await upload(owner, 'contacts', 'a,"b\n1')).status).toBe(400); // unterminated quote
    });

    it('enforces the byte cap (413) and the plan row cap (402)', async () => {
      const big = `firstName\n${'x'.repeat(1024 * 1024 + 10)}`;
      expect((await upload(owner, 'contacts', big)).status).toBe(413);
      const rows = ['firstName', ...Array.from({ length: 501 }, (_, i) => `n${i}`)].join('\n');
      const res = await upload(owner, 'contacts', rows);
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe('ENTITLEMENT_EXCEEDED');
      const ok = await upload(
        owner,
        'contacts',
        ['firstName', ...Array.from({ length: 500 }, (_, i) => `n${i}`)].join('\n'),
      );
      expect(ok.status).toBe(201); // exactly the free-plan cap
    });

    it('needs an active subscription', async () => {
      await ctx.prisma.client.subscription.update({
        where: { organizationId: orgId },
        data: { status: 'past_due' },
      });
      const res = await upload(owner, 'contacts', 'firstName\nA');
      expect(res.status).toBe(402);
      await ctx.prisma.client.subscription.update({
        where: { organizationId: orgId },
        data: { status: 'active' },
      });
      expect((await upload(owner, 'contacts', 'firstName\nA')).status).toBe(201);
    });

    it('requires data:import and the entity create permission', async () => {
      expect((await upload(member, 'contacts', 'firstName\nA')).status).toBe(403);
      // grant data:import only (no leads:create is NOT the case for members, so remove it from a custom check below)
      const roles = (await api().get('/api/v1/roles')).body.data as Role[];
      const role = roles.find((r) => r.key === 'member')!;
      await ctx.prisma.client.role.update({
        where: { id: role.id },
        data: { permissions: [...role.permissions, 'data:import'] },
      });
      expect((await upload(member, 'contacts', 'firstName\nA')).status).toBe(201);
      await ctx.prisma.client.role.update({
        where: { id: role.id },
        data: {
          permissions: role.permissions
            .filter((p: string) => p !== 'contacts:create')
            .concat('data:import'),
        },
      });
      expect((await upload(member, 'contacts', 'firstName\nA')).status).toBe(403);
      await ctx.prisma.client.role.update({
        where: { id: role.id },
        data: { permissions: role.permissions },
      });
    });
  });

  describe('validate / execute / cancel', () => {
    let job: ImportUploadResult;
    const csv =
      'name,email\nDana,dana@example.com\nDana again,DANA@example.com\n,bad-email\nNoEmail,\n';

    beforeAll(async () => {
      await resetJobs();
      await api()
        .post('/api/v1/contacts')
        .send({ firstName: 'Existing', email: 'noemail-dup@example.com' });
      await api().post('/api/v1/contacts').send({ firstName: 'Old', email: 'old@example.com' });
      job = (
        await upload(
          owner,
          'contacts',
          'first,email\nDana,dana@example.com\nDana2,DANA@example.com\n,bad\nOld,old@example.com\nNew,\n',
        )
      ).body.data;
    });

    it('dry-runs with per-row errors and duplicate detection (existing + in-file), writing nothing', async () => {
      void csv;
      const bad = await api()
        .post(`/api/v1/imports/${job.id}/validate`)
        .send({ mapping: { email: 1 } });
      expect(bad.status).toBe(400); // firstName not mapped
      const outOfRange = await api()
        .post(`/api/v1/imports/${job.id}/validate`)
        .send({ mapping: { firstName: 9 } });
      expect(outOfRange.status).toBe(400);

      const res = await api()
        .post(`/api/v1/imports/${job.id}/validate`)
        .send({ mapping: { firstName: 0, email: 1 }, duplicateStrategy: 'skip' });
      expect(res.status).toBe(200);
      const body = res.body.data as ImportJob;
      expect(body.status).toBe('validated');
      expect(body.validation).toMatchObject({ total: 5, valid: 2, invalid: 1, duplicates: 2 });
      const rows = body.validation!.rows;
      expect(rows.find((r) => r.row === 2)).toMatchObject({
        status: 'duplicate',
        duplicateOf: { source: 'file', row: 1, matchedBy: 'email' },
      });
      expect(rows.find((r) => r.row === 3)).toMatchObject({ status: 'invalid' });
      expect(rows.find((r) => r.row === 4)).toMatchObject({
        status: 'duplicate',
        duplicateOf: { source: 'existing', matchedBy: 'email' },
      });
      expect(await ctx.prisma.client.contact.count({ where: { organizationId: orgId } })).toBe(2); // nothing imported
      expect(
        await ctx.prisma.client.auditLog.count({
          where: { organizationId: orgId, action: AuditAction.IMPORT_VALIDATED, targetId: job.id },
        }),
      ).toBe(1);
    });

    it('executes by queueing a worker job (idempotent key), status queued, audited; a second execute conflicts', async () => {
      const res = await api()
        .post(`/api/v1/imports/${job.id}/execute`)
        .send({ mapping: { firstName: 0, email: 1 }, duplicateStrategy: 'update' });
      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({
        status: 'queued',
        duplicateStrategy: 'update',
        mapping: { firstName: 0, email: 1 },
      });
      const jobs = await jobsOn(ctx, QueueName.IMPORTS);
      const queued = jobs.find((j) => j.data.importId === job.id);
      expect(queued?.data).toMatchObject({
        organizationId: orgId,
        importId: job.id,
        idempotencyKey: `import-${job.id}`,
      });
      expect(jobs.filter((j) => j.data.importId === job.id)).toHaveLength(1);
      expect(
        (
          await api()
            .post(`/api/v1/imports/${job.id}/execute`)
            .send({ mapping: { firstName: 0 } })
        ).status,
      ).toBe(409);
      expect(
        (
          await api()
            .post(`/api/v1/imports/${job.id}/validate`)
            .send({ mapping: { firstName: 0 } })
        ).status,
      ).toBe(409);
      expect(
        await ctx.prisma.client.auditLog.count({
          where: { organizationId: orgId, action: AuditAction.IMPORT_STARTED, targetId: job.id },
        }),
      ).toBe(1);
      expect(await ctx.prisma.client.contact.count({ where: { organizationId: orgId } })).toBe(2); // the API itself never writes rows
    });

    it('limits concurrent imports, cancels, lists, reads and reports', async () => {
      const second = (await upload(owner, 'contacts', 'first\nX\n')).body
        .data as ImportUploadResult;
      const third = (await upload(owner, 'contacts', 'first\nY\n')).body.data as ImportUploadResult;
      expect(
        (
          await api()
            .post(`/api/v1/imports/${second.id}/execute`)
            .send({ mapping: { firstName: 0 } })
        ).status,
      ).toBe(202);
      const capped = await api()
        .post(`/api/v1/imports/${third.id}/execute`)
        .send({ mapping: { firstName: 0 } });
      expect(capped.status).toBe(402); // job.id + second are already active (max 2)

      const cancelled = await api().post(`/api/v1/imports/${second.id}/cancel`).send();
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data.status).toBe('cancelled');
      expect((await api().post(`/api/v1/imports/${second.id}/cancel`).send()).status).toBe(409);
      expect(
        await ctx.prisma.client.auditLog.count({
          where: {
            organizationId: orgId,
            action: AuditAction.IMPORT_CANCELLED,
            targetId: second.id,
          },
        }),
      ).toBe(1);

      const list = await api().get('/api/v1/imports?status=queued');
      expect(list.body.data.map((j: ImportJob) => j.id)).toEqual([job.id]);
      expect((await api().get(`/api/v1/imports?entity=leads`)).body.data).toHaveLength(0);
      expect((await api().get(`/api/v1/imports/${job.id}`)).body.data.id).toBe(job.id);
    });

    it('serves the report as JSON and as a BOM-prefixed CSV', async () => {
      await ctx.prisma.client.importJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          createdCount: 2,
          skippedCount: 1,
          failedCount: 1,
          report: [
            { row: 2, status: 'skipped', reason: 'Duplicate of row 1' },
            { row: 3, status: 'failed', reason: '=cmd|"x"' },
          ],
        },
      });
      const json = await api().get(`/api/v1/imports/${job.id}/report`);
      expect(json.body.data).toMatchObject({
        importId: job.id,
        status: 'completed',
        result: { created: 2, skipped: 1, failed: 1 },
        truncated: false,
      });
      const csv = await api()
        .get(`/api/v1/imports/${job.id}/report.csv`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
        });
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      const text = csv.body as unknown as string;
      expect(text.startsWith(`${BOM}row,status,reason`)).toBe(true);
      expect(text).toContain("'=cmd|"); // formula-injection safe
    });
  });

  describe('export', () => {
    beforeAll(async () => {
      await ctx.prisma.client.contact.deleteMany({ where: { organizationId: orgId } });
      for (const body of [
        {
          firstName: 'Dana',
          lastName: 'כהן',
          email: 'dana@example.com',
          phone: '+972501234567',
          notes: '=HYPERLINK("http://evil")',
          tags: ['vip'],
        },
        { firstName: 'Yossi', lastName: 'Levi, Jr', email: 'yossi@example.com', tags: [] },
        { firstName: 'Multi', notes: 'line1\nline2' },
      ]) {
        await api().post('/api/v1/contacts').send(body).expect(201);
      }
      const company = await api().post('/api/v1/companies').send({ name: '@Strange Co' });
      expect(company.status).toBe(201);
      await api()
        .post('/api/v1/deals')
        .send({ title: 'Export deal', value: 500, currency: 'ILS' })
        .expect(201);
      await api().post('/api/v1/tasks').send({ title: '+task' }).expect(201);
      await api().post('/api/v1/leads').send({ title: 'Export lead', value: 10 }).expect(201);
    });

    const get = (actor: Actor, path: string) =>
      api(actor)
        .get(path)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
        });

    it('requires data:export (members do not have it)', async () => {
      for (const e of ['contacts', 'leads', 'companies', 'deals', 'tasks']) {
        expect((await api(member).get(`/api/v1/export/${e}`)).status).toBe(403);
      }
    });

    it('streams contacts with BOM, header, escaping, Hebrew, filters and writes an audit entry', async () => {
      const res = await get(owner, '/api/v1/export/contacts?sortBy=firstName&sortOrder=asc');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      const text = res.body as unknown as string;
      expect(text.startsWith(BOM)).toBe(true);
      const lines = text.slice(1).split('\r\n');
      expect(lines[0]).toBe(
        'id,firstName,lastName,email,phone,company,jobTitle,tags,notes,ownerEmail,createdAt',
      );
      expect(text).toContain('"\'=HYPERLINK(""http://evil"")"'); // apostrophe-prefixed, then quoted
      expect(text).toContain("'+972501234567");
      expect(text).toContain('כהן');
      expect(text).toContain('"Levi, Jr"');
      expect(text).toContain('"line1\nline2"');
      const filtered = await get(owner, '/api/v1/export/contacts?tag=vip');
      expect((filtered.body as unknown as string).trim().split('\r\n')).toHaveLength(2);
      const search = await get(owner, '/api/v1/export/contacts?search=yossi');
      expect(search.body as unknown as string).toContain('yossi@example.com');
      expect(search.body as unknown as string).not.toContain('dana@example.com');
      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { organizationId: orgId, action: AuditAction.DATA_EXPORTED },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit?.metadata).toMatchObject({ entity: 'contacts', rows: 3, completed: true });
    });

    it('exports leads, companies, deals and tasks (formula-safe)', async () => {
      const companies = (await get(owner, '/api/v1/export/companies')).body as unknown as string;
      expect(companies).toContain("'@Strange Co");
      const deals = (await get(owner, '/api/v1/export/deals')).body as unknown as string;
      expect(deals.split('\r\n')[0]).toContain('pipeline,stage,status');
      expect(deals).toContain('Export deal');
      expect(deals).toContain(',Sales,Lead,open,');
      const tasks = (await get(owner, '/api/v1/export/tasks?status=todo'))
        .body as unknown as string;
      expect(tasks).toContain("'+task");
      const leads = (await get(owner, '/api/v1/export/leads')).body as unknown as string;
      expect(leads).toContain('Export lead');
      expect(
        await ctx.prisma.client.auditLog.count({
          where: { organizationId: orgId, action: AuditAction.DATA_EXPORTED },
        }),
      ).toBeGreaterThanOrEqual(4);
    });

    it('streams large exports in batches without dropping or duplicating rows', async () => {
      await ctx.prisma.client.contact.createMany({
        data: Array.from({ length: 1200 }, (_, i) => ({
          organizationId: orgId,
          firstName: `Bulk${String(i).padStart(4, '0')}`,
          email: `bulk${i}@example.com`,
        })),
      });
      const text = (await get(owner, '/api/v1/export/contacts?sortBy=firstName&sortOrder=asc'))
        .body as unknown as string;
      const lines = text.slice(1).trim().split('\r\n');
      expect(lines).toHaveLength(1 + 3 + 1200);
      const emails = lines.filter((l) => l.includes('bulk')).map((l) => l.split(',')[3]);
      expect(new Set(emails).size).toBe(1200);
      await ctx.prisma.client.contact.deleteMany({
        where: { organizationId: orgId, firstName: { startsWith: 'Bulk' } },
      });
    });
  });
});
