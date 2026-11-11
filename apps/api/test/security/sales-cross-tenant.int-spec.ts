import { type Pipeline, type Role } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from '../setup/test-app';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

/**
 * Tenant isolation for tasks, companies, pipelines, deals, imports and exports: every endpoint is exercised with
 * (a) a forged x-organization-id (403 NOT_A_MEMBER), (b) ids of another organization while scoped to the caller's own
 * (404 / 400 / notFound entries, never a leak), plus the member-role permission boundaries.
 */
describe('Security: tasks / deals / companies / data exchange cross-tenant isolation', () => {
  let ctx: TestContext;
  let userA: Actor;
  let userB: Actor;
  let memberA: Actor;
  let orgA: string;
  let orgB: string;
  let b: {
    taskId: string;
    companyId: string;
    contactId: string;
    leadId: string;
    dealId: string;
    noteId: string;
    pipeline: Pipeline;
    importId: string;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userA = await register(ctx, { firstName: 'Alice', lastName: 'A' });
    userB = await register(ctx, { firstName: 'Bob', lastName: 'B' });
    memberA = await register(ctx, { firstName: 'Mel', lastName: 'Member' });
    orgA = (await createOrganization(ctx, userA, 'Org A')).id;
    orgB = (await createOrganization(ctx, userB, 'Org B')).id;
    const roles = (await as(ctx, userA, orgA).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgA,
        userId: memberA.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });

    const B = as(ctx, userB, orgB);
    const contactId = (
      await B.post('/api/v1/contacts').send({ firstName: 'Secret', email: 'secret@orgb.test' })
    ).body.data.id;
    const leadId = (await B.post('/api/v1/leads').send({ title: 'B lead' })).body.data.id;
    const companyId = (await B.post('/api/v1/companies').send({ name: 'B Secret Corp' })).body.data
      .id;
    const pipeline = (await B.get('/api/v1/pipelines')).body.data[0] as Pipeline;
    const dealId = (
      await B.post('/api/v1/deals').send({
        title: 'B secret deal',
        value: 99999,
        contactId,
        companyId,
      })
    ).body.data.id;
    const noteId = (await B.post(`/api/v1/deals/${dealId}/notes`).send({ body: 'B private note' }))
      .body.data.id;
    const taskId = (
      await B.post('/api/v1/tasks').send({ title: 'B secret task', dealId, leadId, contactId })
    ).body.data.id;
    const imp = await B.post('/api/v1/imports')
      .field('entity', 'contacts')
      .attach('file', Buffer.from('first,email\nB,b@orgb.test\n'), {
        filename: 'b.csv',
        contentType: 'text/csv',
      });
    expect(imp.status).toBe(201);
    b = {
      taskId,
      companyId,
      contactId,
      leadId,
      dealId,
      noteId,
      pipeline,
      importId: imp.body.data.id,
    };
  });

  afterAll(async () => {
    await ctx.close();
  });

  type Call = [
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: Record<string, unknown>,
  ];
  const endpoints = (): Call[] => {
    const st = b.pipeline.stages;
    return [
      ['get', '/api/v1/tasks'],
      ['post', '/api/v1/tasks', { title: 'x' }],
      ['post', '/api/v1/tasks/bulk-assign', { taskIds: [b.taskId], assigneeId: null }],
      ['get', `/api/v1/tasks/${b.taskId}`],
      ['patch', `/api/v1/tasks/${b.taskId}`, { title: 'hacked' }],
      ['delete', `/api/v1/tasks/${b.taskId}`],
      ['post', `/api/v1/tasks/${b.taskId}/complete`, {}],
      ['post', `/api/v1/tasks/${b.taskId}/reopen`, {}],
      ['get', '/api/v1/companies'],
      ['post', '/api/v1/companies', { name: 'x' }],
      ['get', `/api/v1/companies/${b.companyId}`],
      ['patch', `/api/v1/companies/${b.companyId}`, { name: 'hacked' }],
      ['delete', `/api/v1/companies/${b.companyId}`],
      ['get', `/api/v1/companies/${b.companyId}/contacts`],
      ['post', `/api/v1/companies/${b.companyId}/contacts`, { contactIds: [b.contactId] }],
      ['delete', `/api/v1/companies/${b.companyId}/contacts/${b.contactId}`],
      ['get', '/api/v1/pipelines'],
      ['post', '/api/v1/pipelines', { name: 'x' }],
      ['get', `/api/v1/pipelines/${b.pipeline.id}`],
      ['patch', `/api/v1/pipelines/${b.pipeline.id}`, { name: 'hacked' }],
      ['delete', `/api/v1/pipelines/${b.pipeline.id}`],
      [
        'post',
        `/api/v1/pipelines/${b.pipeline.id}/stages`,
        { name: 's', kind: 'open', probability: 5 },
      ],
      ['patch', `/api/v1/pipelines/${b.pipeline.id}/stages/${st[0]!.id}`, { name: 'hacked' }],
      ['delete', `/api/v1/pipelines/${b.pipeline.id}/stages/${st[0]!.id}`],
      ['put', `/api/v1/pipelines/${b.pipeline.id}/stages/order`, { stageIds: st.map((s) => s.id) }],
      ['get', '/api/v1/deals'],
      ['post', '/api/v1/deals', { title: 'x' }],
      ['get', '/api/v1/deals/board'],
      ['get', '/api/v1/deals/reports/conversion'],
      ['get', `/api/v1/deals/${b.dealId}`],
      ['patch', `/api/v1/deals/${b.dealId}`, { title: 'hacked' }],
      ['delete', `/api/v1/deals/${b.dealId}`],
      ['post', `/api/v1/deals/${b.dealId}/move`, { stageId: st[1]!.id }],
      ['get', `/api/v1/deals/${b.dealId}/notes`],
      ['post', `/api/v1/deals/${b.dealId}/notes`, { body: 'x' }],
      ['delete', `/api/v1/deals/${b.dealId}/notes/${b.noteId}`],
      ['get', `/api/v1/deals/${b.dealId}/activities`],
      ['get', '/api/v1/imports'],
      ['get', `/api/v1/imports/${b.importId}`],
      ['post', `/api/v1/imports/${b.importId}/validate`, { mapping: { firstName: 0 } }],
      ['post', `/api/v1/imports/${b.importId}/execute`, { mapping: { firstName: 0 } }],
      ['post', `/api/v1/imports/${b.importId}/cancel`, {}],
      ['get', `/api/v1/imports/${b.importId}/report`],
      ['get', `/api/v1/imports/${b.importId}/report.csv`],
      ['get', '/api/v1/export/contacts'],
      ['get', '/api/v1/export/leads'],
      ['get', '/api/v1/export/companies'],
      ['get', '/api/v1/export/deals'],
      ['get', '/api/v1/export/tasks'],
    ];
  };

  const send = (actor: Actor, org: string, [method, path, body]: Call) => {
    const req = as(ctx, actor, org)[method](path);
    return body ? req.send(body) : req;
  };

  it('a forged x-organization-id gets 403 NOT_A_MEMBER on EVERY endpoint', async () => {
    for (const call of endpoints()) {
      const res = await send(userA, orgB, call);
      expect({ call: `${call[0]} ${call[1]}`, status: res.status }).toEqual({
        call: `${call[0]} ${call[1]}`,
        status: 403,
      });
      if (res.body?.error) expect(res.body.error.code).toBe('NOT_A_MEMBER');
    }
  });

  it("org B's ids addressed from org A return 404 (never 200/403) and leave B's data untouched", async () => {
    const byId = endpoints().filter(
      ([, path]) =>
        path.includes(b.taskId) ||
        path.includes(b.companyId) ||
        path.includes(b.pipeline.id) ||
        path.includes(b.dealId) ||
        path.includes(b.importId),
    );
    expect(byId.length).toBeGreaterThan(30);
    for (const call of byId) {
      const res = await send(userA, orgA, call);
      expect({ call: `${call[0]} ${call[1]}`, status: res.status }).toEqual({
        call: `${call[0]} ${call[1]}`,
        status: 404,
      });
    }
    const db = ctx.prisma.client;
    expect((await db.task.findUniqueOrThrow({ where: { id: b.taskId } })).title).toBe(
      'B secret task',
    );
    expect((await db.company.findUniqueOrThrow({ where: { id: b.companyId } })).name).toBe(
      'B Secret Corp',
    );
    const deal = await db.deal.findUniqueOrThrow({ where: { id: b.dealId } });
    expect(deal).toMatchObject({ title: 'B secret deal', stageId: b.pipeline.stages[0]!.id });
    expect((await db.importJob.findUniqueOrThrow({ where: { id: b.importId } })).status).toBe(
      'uploaded',
    );
    expect(await db.dealNote.count({ where: { id: b.noteId } })).toBe(1);
    expect(await db.pipelineStage.count({ where: { pipelineId: b.pipeline.id } })).toBe(6);
    expect(
      (await db.contact.findUniqueOrThrow({ where: { id: b.contactId } })).companyId,
    ).toBeNull();
  });

  it('collections never contain org B data', async () => {
    const A = as(ctx, userA, orgA);
    await A.post('/api/v1/tasks').send({ title: 'A task' }).expect(201);
    await A.post('/api/v1/deals').send({ title: 'A deal' }).expect(201);
    await A.post('/api/v1/companies').send({ name: 'A Corp' }).expect(201);
    for (const path of [
      '/api/v1/tasks',
      '/api/v1/deals',
      '/api/v1/companies',
      '/api/v1/pipelines',
      '/api/v1/imports',
      '/api/v1/deals/board',
    ]) {
      const res = await A.get(path);
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      for (const secret of [
        'B secret',
        'B Secret',
        'secret@orgb',
        b.dealId,
        b.taskId,
        b.companyId,
        b.pipeline.id,
        b.importId,
      ]) {
        expect(text).not.toContain(secret);
      }
    }
    const report = await A.get('/api/v1/deals/reports/conversion');
    expect(JSON.stringify(report.body)).not.toContain(b.pipeline.id);
    const sales = await A.get('/api/v1/analytics/sales');
    expect(JSON.stringify(sales.body)).not.toContain('B secret');
    expect(sales.body.data.closedInRange).toEqual([]);
  });

  it('explicit foreign pipeline/stage ids in query or body are 404 / 400', async () => {
    const A = as(ctx, userA, orgA);
    expect((await A.get(`/api/v1/deals/board?pipelineId=${b.pipeline.id}`)).status).toBe(404);
    expect(
      (await A.get(`/api/v1/deals/reports/conversion?pipelineId=${b.pipeline.id}`)).status,
    ).toBe(404);
    expect(
      (await A.post('/api/v1/deals').send({ title: 'x', pipelineId: b.pipeline.id })).status,
    ).toBe(400);
    expect(
      (await A.post('/api/v1/deals').send({ title: 'x', stageId: b.pipeline.stages[0]!.id }))
        .status,
    ).toBe(400);
    expect(
      (await A.post('/api/v1/deals').send({ title: 'x', contactId: b.contactId })).status,
    ).toBe(400);
    expect(
      (await A.post('/api/v1/deals').send({ title: 'x', companyId: b.companyId })).status,
    ).toBe(400);
    expect(
      (await A.post('/api/v1/deals').send({ title: 'x', ownerId: userB.user.id })).status,
    ).toBe(400);
    expect((await A.post('/api/v1/tasks').send({ title: 'x', dealId: b.dealId })).status).toBe(400);
    expect((await A.post('/api/v1/tasks').send({ title: 'x', leadId: b.leadId })).status).toBe(400);
    expect(
      (await A.post('/api/v1/tasks').send({ title: 'x', contactId: b.contactId })).status,
    ).toBe(400);
    expect(
      (await A.post('/api/v1/tasks').send({ title: 'x', assigneeId: userB.user.id })).status,
    ).toBe(400);
    expect(
      (await A.post('/api/v1/contacts').send({ firstName: 'x', companyId: b.companyId })).status,
    ).toBe(400);
    expect((await A.get(`/api/v1/tasks?dealId=${b.dealId}`)).body.data).toEqual([]);
    expect((await A.get(`/api/v1/deals?companyId=${b.companyId}`)).body.data).toEqual([]);

    // a deal of A moved to a stage of B's pipeline, a stage of A deleted into B's stage
    const own = (await A.post('/api/v1/deals').send({ title: 'own' })).body.data;
    expect(
      (await A.post(`/api/v1/deals/${own.id}/move`).send({ stageId: b.pipeline.stages[2]!.id }))
        .status,
    ).toBe(400);
    const pipelineA = (await A.get('/api/v1/pipelines')).body.data[0] as Pipeline;
    const del = await A.delete(
      `/api/v1/pipelines/${pipelineA.id}/stages/${pipelineA.stages[0]!.id}?moveDealsToStageId=${b.pipeline.stages[1]!.id}`,
    );
    expect(del.status).toBe(409); // a foreign stage is not a valid destination; nothing is moved
    expect((await A.get(`/api/v1/deals/${own.id}`)).body.data.stageId).toBe(
      pipelineA.stages[0]!.id,
    );
    expect(
      (
        await A.post(`/api/v1/tasks/bulk-assign`).send({
          taskIds: [b.taskId, UNKNOWN],
          assigneeId: null,
        })
      ).body.data,
    ).toMatchObject({
      updated: 0,
      notFound: expect.arrayContaining([b.taskId, UNKNOWN]),
    });
    const mapped = await A.post(
      `/api/v1/companies/${(await A.get('/api/v1/companies')).body.data[0].id}/contacts`,
    ).send({ contactIds: [b.contactId] });
    expect(mapped.body.data).toMatchObject({ associated: 0, notFound: [b.contactId] });
  });

  it('exports contain only the caller organization rows', async () => {
    const A = as(ctx, userA, orgA);
    for (const e of ['contacts', 'leads', 'companies', 'deals', 'tasks']) {
      const res = await A.get(`/api/v1/export/${e}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
        });
      expect(res.status).toBe(200);
      const text = res.body as unknown as string;
      expect(text).not.toMatch(/B secret|B Secret|secret@orgb|B lead/);
    }
  });

  it('member role: no pipeline management, import, export, task delete/assign or deal delete', async () => {
    const M = as(ctx, memberA, orgA);
    const deal = (await M.post('/api/v1/deals').send({ title: 'member deal' })).body.data;
    const forbidden: Call[] = [
      ['post', '/api/v1/pipelines', { name: 'nope' }],
      [
        'patch',
        `/api/v1/pipelines/${(await M.get('/api/v1/pipelines')).body.data[0].id}`,
        { name: 'nope' },
      ],
      ['get', '/api/v1/imports'],
      ['get', '/api/v1/export/contacts'],
      ['get', '/api/v1/export/deals'],
      ['delete', `/api/v1/deals/${deal.id}`],
      ['post', '/api/v1/tasks/bulk-assign', { taskIds: [UNKNOWN], assigneeId: null }],
    ];
    for (const call of forbidden) {
      const res = await send(memberA, orgA, call);
      expect({ call: `${call[0]} ${call[1]}`, status: res.status }).toEqual({
        call: `${call[0]} ${call[1]}`,
        status: 403,
      });
    }
    expect((await M.post('/api/v1/tasks').send({ title: 'ok' })).status).toBe(201);
    expect((await M.get('/api/v1/pipelines')).status).toBe(200);
    expect(
      (
        await M.post(`/api/v1/deals/${deal.id}/move`).send({
          stageId: (await M.get('/api/v1/pipelines')).body.data[0].stages[1].id,
        })
      ).status,
    ).toBe(200);
  });

  it('unauthenticated requests are rejected', async () => {
    for (const [, path] of endpoints().slice(0, 12)) {
      const res = await as(ctx, { accessToken: 'invalid' }, orgA).get(path);
      expect([401, 404]).toContain(res.status);
    }
  });
});
