import {
  AuditAction,
  type BoardColumn,
  type DealBoard,
  QueueName,
  type Role,
  type Pipeline,
  type DealWithRelations,
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

describe('Companies, pipelines and deals', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let other: Actor;
  let orgId: string;
  let otherOrgId: string;
  let pipeline: Pipeline;
  let stage: Record<string, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    other = await register(ctx, { firstName: 'Oscar', lastName: 'Other' });
    orgId = (await createOrganization(ctx, owner, 'Deals Co')).id;
    otherOrgId = (await createOrganization(ctx, other, 'Other Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: { organizationId: orgId, userId: member.user.id, roleId: roles.find((r) => r.key === 'member')!.id, status: 'active' },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function events(name: string) {
    const jobs = await jobsOn(ctx, QueueName.AUTOMATION);
    return jobs.filter((j) => j.data.kind === 'event' && j.data.event === name && j.data.organizationId === orgId);
  }
  const api = (actor: Actor = owner, org = orgId) => as(ctx, actor, org);

  describe('default pipeline', () => {
    it('is created with the organization, with the six default stages', async () => {
      const res = await api().get('/api/v1/pipelines');
      expect(res.status).toBe(200);
      const list = res.body.data as Pipeline[];
      expect(list).toHaveLength(1);
      pipeline = list[0]!;
      expect(pipeline).toMatchObject({ name: 'Sales', isDefault: true });
      expect(pipeline.stages.map((s) => [s.name, s.kind, s.order])).toEqual([
        ['Lead', 'open', 0],
        ['Qualified', 'open', 1],
        ['Proposal', 'open', 2],
        ['Negotiation', 'open', 3],
        ['Won', 'won', 4],
        ['Lost', 'lost', 5],
      ]);
      stage = Object.fromEntries(pipeline.stages.map((s) => [s.name, s.id]));
    });
  });

  describe('companies', () => {
    let companyId: string;
    it('creates, searches, associates contacts and updates', async () => {
      const created = await api().post('/api/v1/companies').send({ name: 'Acme Ltd', domain: 'https://www.acme.io', tags: ['b2b'] });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ name: 'Acme Ltd', domain: 'acme.io', tags: ['b2b'] });
      companyId = created.body.data.id;
      expect(await ctx.prisma.client.auditLog.count({ where: { organizationId: orgId, action: AuditAction.COMPANY_CREATED, targetId: companyId } })).toBe(1);

      const c1 = (await api().post('/api/v1/contacts').send({ firstName: 'A' })).body.data.id;
      const c2 = (await api().post('/api/v1/contacts').send({ firstName: 'B', companyId })).body.data;
      expect(c2.companyId).toBe(companyId);
      const assoc = await api().post(`/api/v1/companies/${companyId}/contacts`).send({ contactIds: [c1, '00000000-0000-4000-8000-000000000000'] });
      expect(assoc.status).toBe(200);
      expect(assoc.body.data).toMatchObject({ associated: 1 });
      const contacts = await api().get(`/api/v1/companies/${companyId}/contacts`);
      expect(contacts.body.data.map((c: { id: string }) => c.id).sort()).toEqual([c1, c2.id].sort());
      const filtered = await api().get(`/api/v1/contacts?companyId=${companyId}`);
      expect(filtered.body.meta.total).toBe(2);
      expect((await api().delete(`/api/v1/companies/${companyId}/contacts/${c1}`)).status).toBe(204);

      expect((await api().get('/api/v1/companies?search=acme')).body.data).toHaveLength(1);
      expect((await api().get('/api/v1/companies?search=nothing')).body.data).toHaveLength(0);
      const upd = await api().patch(`/api/v1/companies/${companyId}`).send({ notes: 'VIP' });
      expect(upd.body.data.notes).toBe('VIP');
      const detail = await api().get(`/api/v1/companies/${companyId}`);
      expect(detail.body.data).toMatchObject({ id: companyId, contactCount: 1 });
    });

    it('rejects a contact referencing another organization company', async () => {
      const foreign = (await api(other, otherOrgId).post('/api/v1/companies').send({ name: 'Foreign Inc' })).body.data.id;
      const res = await api().post('/api/v1/contacts').send({ firstName: 'X', companyId: foreign });
      expect(res.status).toBe(400);
    });

    it('members create/update but cannot delete', async () => {
      const c = await api(member).post('/api/v1/companies').send({ name: 'Member Co' });
      expect(c.status).toBe(201);
      expect((await api(member).delete(`/api/v1/companies/${c.body.data.id}`)).status).toBe(403);
      expect((await api().delete(`/api/v1/companies/${c.body.data.id}`)).status).toBe(204);
    });
  });

  describe('pipelines', () => {
    it('only managers can create pipelines; stage sets are validated', async () => {
      expect((await api(member).post('/api/v1/pipelines').send({ name: 'Mine' })).status).toBe(403);
      const bad = await api().post('/api/v1/pipelines').send({
        name: 'Broken',
        stages: [
          { name: 'a', kind: 'open', probability: 10 },
          { name: 'b', kind: 'open', probability: 20 },
          { name: 'c', kind: 'won', probability: 100 },
        ],
      });
      expect(bad.status).toBe(400);
      const ok = await api().post('/api/v1/pipelines').send({ name: 'Partners' });
      expect(ok.status).toBe(201);
      expect(ok.body.data.isDefault).toBe(false);
      expect(ok.body.data.stages).toHaveLength(6);
      expect((await api().post('/api/v1/pipelines').send({ name: 'Partners' })).status).toBe(409);
    });

    it('adds, renames, reorders and deletes stages; deleting a stage with deals needs a destination', async () => {
      const p = (await api().post('/api/v1/pipelines').send({ name: 'Stage lab' })).body.data as Pipeline;
      const added = await api().post(`/api/v1/pipelines/${p.id}/stages`).send({ name: 'Demo', kind: 'open', probability: 40 });
      expect(added.status).toBe(201);
      const names = (added.body.data as Pipeline).stages.map((s) => s.name);
      expect(names.indexOf('Demo')).toBeLessThan(names.indexOf('Won')); // before the first closed stage
      const demo = (added.body.data as Pipeline).stages.find((s) => s.name === 'Demo')!;
      const renamed = await api().patch(`/api/v1/pipelines/${p.id}/stages/${demo.id}`).send({ name: 'Demo call', probability: 45 });
      expect((renamed.body.data as Pipeline).stages.find((s) => s.id === demo.id)).toMatchObject({ name: 'Demo call', probability: 45 });

      const ids = (renamed.body.data as Pipeline).stages.map((s) => s.id).reverse();
      const reordered = await api().put(`/api/v1/pipelines/${p.id}/stages/order`).send({ stageIds: ids });
      expect((reordered.body.data as Pipeline).stages.map((s) => s.id)).toEqual(ids);
      expect((await api().put(`/api/v1/pipelines/${p.id}/stages/order`).send({ stageIds: ids.slice(1) })).status).toBe(400);

      const deal = (await api().post('/api/v1/deals').send({ title: 'In demo', pipelineId: p.id, stageId: demo.id })).body.data;
      const first = (reordered.body.data as Pipeline).stages.find((s) => s.kind === 'open' && s.id !== demo.id)!;
      expect((await api().delete(`/api/v1/pipelines/${p.id}/stages/${demo.id}`)).status).toBe(409);
      const del = await api().delete(`/api/v1/pipelines/${p.id}/stages/${demo.id}?moveDealsToStageId=${first.id}`);
      expect(del.status).toBe(200);
      expect((await api().get(`/api/v1/deals/${deal.id}`)).body.data.stageId).toBe(first.id);
      // pipeline holding deals / default pipeline cannot be removed
      expect((await api().delete(`/api/v1/pipelines/${p.id}`)).status).toBe(409);
      expect((await api().delete(`/api/v1/pipelines/${pipeline.id}`)).status).toBe(409);
      await api().delete(`/api/v1/deals/${deal.id}`).expect(204);
      expect((await api().delete(`/api/v1/pipelines/${p.id}`)).status).toBe(204);
    });
  });

  describe('deals and the Kanban board', () => {
    const ids: string[] = [];
    let contactId: string;

    it('creates deals in the default pipeline / first stage, records history and emits deal.created', async () => {
      contactId = (await api().post('/api/v1/contacts').send({ firstName: 'Dana', email: 'dana@deals.test' })).body.data.id;
      for (const [title, value] of [['D1', 1000], ['D2', 2000], ['D3', 3000]] as const) {
        const res = await api(member).post('/api/v1/deals').send({ title, value, currency: 'usd', contactId, tags: ['t1'] });
        expect(res.status).toBe(201);
        ids.push(res.body.data.id);
        expect(res.body.data).toMatchObject({
          title,
          value,
          currency: 'USD',
          status: 'open',
          pipelineId: pipeline.id,
          stageId: stage.Lead,
          contact: { id: contactId },
        });
      }
      const rows = await ctx.prisma.client.dealStageChange.findMany({ where: { dealId: ids[0]! } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ fromStageId: null, toStageId: stage.Lead });
      expect((await events('deal.created')).length).toBeGreaterThanOrEqual(3);
      expect(await ctx.prisma.client.auditLog.count({ where: { organizationId: orgId, action: AuditAction.DEAL_CREATED } })).toBeGreaterThanOrEqual(3);
    });

    it('filters and sorts the list', async () => {
      const res = await api().get(`/api/v1/deals?stageId=${stage.Lead}&sortBy=value&sortOrder=desc&minValue=1500`);
      expect(res.body.data.map((d: DealWithRelations) => d.title)).toEqual(['D3', 'D2']);
      expect((await api().get(`/api/v1/deals?contactId=${contactId}&tag=t1`)).body.meta.total).toBe(3);
      expect((await api().get('/api/v1/deals?search=d1')).body.data).toHaveLength(1);
      expect((await api().get('/api/v1/deals?status=won')).body.data).toHaveLength(0);
    });

    it('returns the board: columns in stage order, deals in position order, per-currency totals', async () => {
      const res = await api().get(`/api/v1/deals/board?pipelineId=${pipeline.id}`);
      expect(res.status).toBe(200);
      const board = res.body.data as DealBoard;
      expect(board.columns.map((c) => c.stage.name)).toEqual(['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
      const lead = board.columns[0] as BoardColumn;
      expect(lead.deals.map((d) => d.title)).toEqual(['D1', 'D2', 'D3']);
      expect(lead.count).toBe(3);
      expect(lead.totals).toEqual([{ currency: 'USD', count: 3, value: 6000, weightedValue: 600 }]);
      expect(board.totals).toEqual([{ currency: 'USD', count: 3, value: 6000, weightedValue: 600 }]);
      const defaultBoard = await api().get('/api/v1/deals/board');
      expect(defaultBoard.body.data.pipeline.id).toBe(pipeline.id);
    });

    it('moves a card between columns keeping both columns contiguous', async () => {
      const move = await api().post(`/api/v1/deals/${ids[1]}/move`).send({ stageId: stage.Qualified });
      expect(move.status).toBe(200);
      expect(move.body.data).toMatchObject({ stageId: stage.Qualified, status: 'open' });
      await api().post(`/api/v1/deals/${ids[2]}/move`).send({ stageId: stage.Qualified, position: 0 }).expect(200);
      const board = (await api().get(`/api/v1/deals/board?pipelineId=${pipeline.id}`)).body.data as DealBoard;
      expect(board.columns[0]!.deals.map((d) => d.title)).toEqual(['D1']);
      expect(board.columns[1]!.deals.map((d) => d.title)).toEqual(['D3', 'D2']);
      const rows = await ctx.prisma.client.deal.findMany({ where: { organizationId: orgId }, select: { stageId: true, position: true } });
      const byStage = new Map<string, number[]>();
      for (const r of rows) byStage.set(r.stageId, [...(byStage.get(r.stageId) ?? []), r.position]);
      for (const positions of byStage.values()) {
        expect(positions.sort((a, b) => a - b)).toEqual(positions.map((_, i) => i));
      }
      // reorder inside a column
      await api().post(`/api/v1/deals/${ids[1]}/move`).send({ stageId: stage.Qualified, position: 0 }).expect(200);
      const again = (await api().get(`/api/v1/deals/board?pipelineId=${pipeline.id}`)).body.data as DealBoard;
      expect(again.columns[1]!.deals.map((d) => d.title)).toEqual(['D2', 'D3']);
      expect((await events('deal.stage_changed')).length).toBe(2); // the in-column reorder is not a stage change
    });

    it('closing stages set status/closedAt, emit deal.won / deal.lost and record the reason; reopening clears them', async () => {
      const won = await api().post(`/api/v1/deals/${ids[0]}/move`).send({ stageId: stage.Won });
      expect(won.body.data).toMatchObject({ status: 'won', stageId: stage.Won });
      expect(won.body.data.closedAt).toBeTruthy();
      const lost = await api().post(`/api/v1/deals/${ids[1]}/move`).send({ stageId: stage.Lost, lostReason: 'Too expensive' });
      expect(lost.body.data).toMatchObject({ status: 'lost', lostReason: 'Too expensive' });
      expect((await events('deal.won')).length).toBe(1);
      expect((await events('deal.lost')).length).toBe(1);
      const reopened = await api().post(`/api/v1/deals/${ids[1]}/move`).send({ stageId: stage.Proposal });
      expect(reopened.body.data).toMatchObject({ status: 'open', closedAt: null, lostReason: null });
      const acts = await api().get(`/api/v1/deals/${ids[1]}/activities`);
      expect(acts.body.data.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['created', 'stage_changed', 'lost', 'reopened']));
      expect(await ctx.prisma.client.auditLog.count({ where: { organizationId: orgId, action: AuditAction.DEAL_STAGE_CHANGED } })).toBe(5);
    });

    it('rejects stages of another pipeline and unknown stage ids', async () => {
      const other2 = (await api().post('/api/v1/pipelines').send({ name: 'Other pipe' })).body.data as Pipeline;
      expect((await api().post(`/api/v1/deals/${ids[2]}/move`).send({ stageId: other2.stages[0]!.id })).status).toBe(400);
      expect((await api().post(`/api/v1/deals/${ids[2]}/move`).send({ stageId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    });

    it('updates (value/owner activities), notes, and deletes', async () => {
      const upd = await api().patch(`/api/v1/deals/${ids[2]}`).send({ value: 3500, ownerId: member.user.id, title: 'D3 renamed' });
      expect(upd.status).toBe(200);
      expect(upd.body.data).toMatchObject({ value: 3500, title: 'D3 renamed', ownerId: member.user.id });
      const types = (await api().get(`/api/v1/deals/${ids[2]}/activities`)).body.data.map((a: { type: string }) => a.type);
      expect(types).toEqual(expect.arrayContaining(['value_changed', 'owner_changed']));
      expect((await api().patch(`/api/v1/deals/${ids[2]}`).send({ ownerId: other.user.id })).status).toBe(400);

      const note = await api(member).post(`/api/v1/deals/${ids[2]}/notes`).send({ body: 'Called, positive' });
      expect(note.status).toBe(201);
      expect((await api().get(`/api/v1/deals/${ids[2]}/notes`)).body.data).toHaveLength(1);
      expect((await api(member).delete(`/api/v1/deals/${ids[2]}`)).status).toBe(403);
      expect((await api(member).delete(`/api/v1/deals/${ids[2]}/notes/${note.body.data.id}`)).status).toBe(204);
    });

    it('conversion report: stage reach, win rate, cycle time, value by stage', async () => {
      const res = await api().get(`/api/v1/deals/reports/conversion?pipelineId=${pipeline.id}`);
      expect(res.status).toBe(200);
      const r = res.body.data;
      expect(r.deals).toMatchObject({ created: 3, won: 1, open: 2, lost: 0 });
      expect(r.winRate).toBe(1);
      expect(r.avgCycleDays).not.toBeNull();
      const lead = r.stages.find((s: { name: string }) => s.name === 'Lead');
      expect(lead.reached).toBe(3);
      expect(r.wonValue).toEqual([{ currency: 'USD', count: 1, value: 1000 }]);
      expect(r.valueByStage.length).toBeGreaterThan(0);
      const bad = await api().get(`/api/v1/deals/reports/conversion?from=2030-01-02T00:00:00.000Z&to=2030-01-01T00:00:00.000Z`);
      expect(bad.status).toBe(400);
    });
  });

  describe('analytics use real deals', () => {
    it('sales report switches to the deals basis and the dashboard pipeline value comes from deals', async () => {
      const sales = (await api().get('/api/v1/analytics/sales')).body.data;
      expect(sales).toMatchObject({ dealsModelled: true, basis: 'deals', closeDateBasis: 'closedAt', pipeline: [], bySource: [] });
      expect(sales.closedInRange).toEqual([
        { currency: 'USD', wonCount: 1, wonValue: 1000, lostCount: 0, lostValue: 0, avgWonValue: 1000 },
      ]);
      expect(sales.stages.some((s: { stageName: string; count: number }) => s.stageName === 'Qualified' && s.count >= 1)).toBe(true);
      const dash = (await api().get('/api/v1/analytics/dashboard')).body.data;
      expect(dash.leads.valueBasis).toBe('deals');
      expect(dash.deals).toMatchObject({ currency: 'USD', wonInPeriod: 1 });
      expect(dash.deals.pipelineValue).toBeGreaterThan(0);
      expect(dash.tasks).toMatchObject({ open: 0, overdue: 0, dueToday: 0 });
    });

    it('an organization without deals keeps the lead-based report', async () => {
      const sales = (await api(other, otherOrgId).get('/api/v1/analytics/sales')).body.data;
      expect(sales).toMatchObject({ dealsModelled: false, basis: 'leads_with_value' });
    });
  });
});
