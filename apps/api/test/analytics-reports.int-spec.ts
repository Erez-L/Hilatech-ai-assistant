import {
  type AgentAnalytics,
  type AutomationAnalytics,
  type BusinessAnalytics,
  ErrorCode,
  Permission,
  type Role,
  type SalesAnalytics,
  type UsageAnalytics,
} from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from './setup/test-app';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe('Analytics reports', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let noAnalytics: Actor;
  let orgId: string;
  let agentA: string;
  let agentB: string;
  let workflowId: string;
  let webhookId: string;

  const get = async <T>(path: string, actor: Actor = owner): Promise<T> => {
    const res = await as(ctx, actor, orgId).get(`/api/v1/analytics/${path}`);
    expect(res.status).toBe(200);
    return res.body.data as T;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    noAnalytics = await register(ctx, { firstName: 'Nia', lastName: 'Nope' });
    orgId = (await createOrganization(ctx, owner, 'Reports Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    const custom = await as(ctx, owner, orgId)
      .post('/api/v1/roles')
      .send({ key: 'no-analytics', name: 'No analytics', permissions: [Permission.ORG_READ] });
    expect(custom.status).toBe(201);
    const db = ctx.prisma.client;
    await db.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
    await db.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: noAnalytics.user.id,
        roleId: custom.body.data.id,
        status: 'active',
      },
    });

    // ----- leads / sales -------------------------------------------------------------------
    const lead = (
      title: string,
      status: 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost',
      source: 'website' | 'referral' | 'other',
      createdDaysAgo: number,
      extra: Record<string, unknown> = {},
    ) =>
      db.lead.create({
        data: {
          organizationId: orgId,
          title,
          status,
          source,
          createdAt: daysAgo(createdDaysAgo),
          updatedAt: daysAgo(createdDaysAgo),
          ...extra,
        },
      });
    await lead('n1', 'new', 'website', 5, { value: 100 });
    await lead('n2', 'new', 'website', 5, { value: 200 });
    await lead('c1', 'contacted', 'referral', 4);
    await lead('q1', 'qualified', 'referral', 4, { value: 1000 });
    await lead('p1', 'proposal', 'website', 3, { value: 5000 });
    await lead('p2', 'proposal', 'other', 3, { value: 700, currency: 'EUR' });
    await lead('w1', 'won', 'website', 10, {
      value: 3000,
      convertedAt: daysAgo(2),
      updatedAt: daysAgo(2),
    });
    await lead('w2', 'won', 'referral', 10, {
      value: 1000,
      convertedAt: daysAgo(2),
      updatedAt: daysAgo(2),
    });
    await lead('l1', 'lost', 'website', 8, { value: 400, updatedAt: daysAgo(1) });
    // outside the default 30d range
    await lead('old', 'won', 'website', 200, { value: 9999, convertedAt: daysAgo(190), updatedAt: daysAgo(190) });
    // soft-deleted lead must never count
    await lead('gone', 'new', 'website', 2, { deletedAt: new Date() });

    await db.contact.createMany({
      data: [
        { organizationId: orgId, firstName: 'C1', createdAt: daysAgo(3) },
        { organizationId: orgId, firstName: 'C2', createdAt: daysAgo(3) },
        { organizationId: orgId, firstName: 'C3', createdAt: daysAgo(100) },
      ],
    });
    await db.conversation.createMany({
      data: [
        { organizationId: orgId, status: 'open', channel: 'web', createdAt: daysAgo(2) },
        { organizationId: orgId, status: 'open', channel: 'email', createdAt: daysAgo(2) },
        { organizationId: orgId, status: 'resolved', channel: 'web', createdAt: daysAgo(1) },
      ],
    });

    // ----- agents ---------------------------------------------------------------------------
    agentA = (
      await as(ctx, owner, orgId)
        .post('/api/v1/agents')
        .send({ name: 'Alpha', instructions: 'x', tools: [] })
    ).body.data.id;
    agentB = (
      await as(ctx, owner, orgId)
        .post('/api/v1/agents')
        .send({ name: 'Beta', instructions: 'y', tools: [] })
    ).body.data.id;
    const exec = (
      agentId: string,
      status: 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'running',
      durationMs: number | null,
      tokens: [number, number],
      cost: number | null,
      createdDaysAgo = 1,
    ) => ({
      organizationId: orgId,
      agentId,
      status,
      input: {},
      durationMs,
      inputTokens: tokens[0],
      outputTokens: tokens[1],
      estimatedCostUsd: cost,
      createdAt: daysAgo(createdDaysAgo),
    });
    await db.agentExecution.createMany({
      data: [
        exec(agentA, 'succeeded', 100, [10, 5], 0.01),
        exec(agentA, 'succeeded', 200, [20, 10], 0.02),
        exec(agentA, 'succeeded', 300, [30, 15], null),
        exec(agentA, 'succeeded', 400, [40, 20], 0.04),
        exec(agentA, 'failed', 1000, [1, 1], 0.001),
        exec(agentB, 'timed_out', 5000, [100, 0], null),
        exec(agentB, 'cancelled', 50, [0, 0], null),
        exec(agentB, 'running', null, [0, 0], null),
        exec(agentB, 'succeeded', 800, [7, 3], null, 400), // outside range
      ],
    });

    // ----- automation -----------------------------------------------------------------------
    workflowId = (
      await db.workflow.create({
        data: { organizationId: orgId, name: 'Welcome flow', trigger: { type: 'manual' }, steps: [] },
      })
    ).id;
    const run = (status: 'succeeded' | 'failed' | 'cancelled', durationMs: number, error?: string) => ({
      organizationId: orgId,
      workflowId,
      status,
      trigger: { type: 'manual' },
      input: {},
      durationMs,
      error: error ?? null,
      createdAt: daysAgo(1),
    });
    await db.workflowExecution.createMany({
      data: [
        run('succeeded', 100),
        run('succeeded', 300),
        run('failed', 50, 'Step http failed: 500'),
        run('failed', 60, 'Step http failed: 500'),
        run('failed', 70, 'Condition evaluation error'),
        run('cancelled', 10),
      ],
    });
    webhookId = (
      await db.webhook.create({
        data: {
          organizationId: orgId,
          url: 'https://example.com/hook',
          events: ['lead.created'],
          encryptedSecret: 'x',
          secretLast4: '1234',
        },
      })
    ).id;
    const delivery = (
      status: 'delivered' | 'failed' | 'pending',
      event: string,
      attempts: number,
      lastError?: string,
      responseStatus?: number,
    ) => ({
      organizationId: orgId,
      webhookId,
      event,
      payload: {},
      status,
      attempts,
      lastError: lastError ?? null,
      responseStatus: responseStatus ?? null,
      createdAt: daysAgo(1),
    });
    await db.webhookDelivery.createMany({
      data: [
        delivery('delivered', 'lead.created', 1, undefined, 200),
        delivery('delivered', 'lead.created', 2, undefined, 200),
        delivery('delivered', 'lead.updated', 1, undefined, 200),
        delivery('failed', 'lead.created', 5, 'connect ECONNREFUSED'),
        delivery('failed', 'lead.updated', 5, undefined, 503),
        delivery('pending', 'lead.updated', 0),
      ],
    });

    // ----- AI usage -------------------------------------------------------------------------
    const log = (
      model: string,
      agentId: string | null,
      userId: string | null,
      inTok: number,
      outTok: number,
      cost: number | null,
      status: 'success' | 'error' = 'success',
    ) => ({
      organizationId: orgId,
      userId,
      agentId,
      provider: 'openai' as const,
      model,
      operation: 'generate' as const,
      status,
      inputTokens: inTok,
      outputTokens: outTok,
      estimatedCostUsd: cost,
      createdAt: daysAgo(1),
    });
    await db.aiRequestLog.createMany({
      data: [
        log('gpt-a', agentA, owner.user.id, 100, 50, 0.5),
        log('gpt-a', agentA, owner.user.id, 200, 100, 1),
        log('gpt-b', null, member.user.id, 10, 5, null),
        log('gpt-b', null, null, 0, 0, null, 'error'),
      ],
    });
    await db.usageRecord.create({
      data: {
        organizationId: orgId,
        userId: owner.user.id,
        metric: 'ai_tokens',
        quantity: BigInt(465),
        periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
        periodEnd: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)),
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('business', () => {
    it('aggregates leads by status/source within the range, ignoring soft-deleted and out-of-range rows', async () => {
      const data = await get<BusinessAnalytics>('business');
      expect(data.leads.created).toBe(9);
      expect(data.leads.byStatus).toMatchObject({
        new: 2, contacted: 1, qualified: 1, proposal: 2, won: 2, lost: 1,
      });
      expect(data.leads.bySource).toMatchObject({ website: 5, referral: 3, other: 1, email: 0 });
      expect(data.contacts.created).toBe(2);
      expect(data.conversations.created).toBe(3);
      expect(data.conversations.byStatus).toMatchObject({ open: 2, resolved: 1, pending: 0 });
      expect(data.conversations.byChannel).toMatchObject({ web: 2, email: 1 });
      expect(data.tasks).toMatchObject({ modelled: true, open: 0, overdue: 0, dueToday: 0 });
    });

    it('computes the funnel from current status (reached = at or beyond) and the conversion rate', async () => {
      const { funnel } = await get<BusinessAnalytics>('business');
      expect(funnel.basis).toBe('current_status_of_leads_created_in_range');
      expect(funnel.stages.map((s) => [s.status, s.reached])).toEqual([
        ['new', 9], ['contacted', 6], ['qualified', 5], ['proposal', 4], ['won', 2],
      ]);
      expect(funnel.lost).toBe(1);
      expect(funnel.conversionRate).toBeCloseTo(2 / 9, 3);
    });

    it('returns zero-filled series with one bucket per granularity step', async () => {
      const day = await get<BusinessAnalytics>('business?granularity=day');
      expect(day.range.buckets).toBe(day.leads.series.length);
      expect(day.leads.series.reduce((a, p) => a + p.count, 0)).toBe(9);
      const week = await get<BusinessAnalytics>('business?granularity=week');
      expect(week.range.granularity).toBe('week');
      expect(week.leads.series.length).toBeLessThanOrEqual(6);
      expect(week.leads.series.reduce((a, p) => a + p.count, 0)).toBe(9);
      const month = await get<BusinessAnalytics>('business?granularity=month');
      expect(month.leads.series.length).toBeLessThanOrEqual(3);
      expect(month.leads.series.reduce((a, p) => a + p.count, 0)).toBe(9);
    });

    it('honours from/to', async () => {
      const from = daysAgo(220).toISOString();
      const to = daysAgo(180).toISOString();
      const data = await get<BusinessAnalytics>(
        `business?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      expect(data.leads.created).toBe(1); // only 'old'
      expect(data.leads.byStatus.won).toBe(1);
    });

    it('validates the range and granularity (400)', async () => {
      const a = as(ctx, owner, orgId);
      const inverted = await a.get(
        `/api/v1/analytics/business?from=${encodeURIComponent(daysAgo(1).toISOString())}&to=${encodeURIComponent(daysAgo(5).toISOString())}`,
      );
      expect(inverted.status).toBe(400);
      expect(inverted.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      const tooLong = await a.get(
        `/api/v1/analytics/business?from=${encodeURIComponent(daysAgo(900).toISOString())}`,
      );
      expect(tooLong.status).toBe(400);
      expect((await a.get('/api/v1/analytics/business?granularity=hour')).status).toBe(400);
      expect((await a.get('/api/v1/analytics/business?from=yesterday')).status).toBe(400);
    });
  });

  describe('sales', () => {
    it('derives pipeline and closed values per currency from leads, with honest labelling', async () => {
      const data = await get<SalesAnalytics>('sales');
      expect(data.dealsModelled).toBe(false);
      expect(data.basis).toBe('leads_with_value');
      const open = (status: string, currency = 'USD') =>
        data.pipeline.find((p) => p.status === status && p.currency === currency);
      expect(open('new')).toMatchObject({ count: 2, value: 300 });
      expect(open('proposal')).toMatchObject({ count: 1, value: 5000 });
      expect(open('proposal', 'EUR')).toMatchObject({ count: 1, value: 700 });
      expect(data.pipeline.some((p) => p.status === 'won' || p.status === 'lost')).toBe(false);
      const usd = data.closedInRange.find((c) => c.currency === 'USD')!;
      expect(usd).toMatchObject({
        wonCount: 2, wonValue: 4000, lostCount: 1, lostValue: 400, avgWonValue: 2000,
      });
      expect(data.winRate).toBeCloseTo(2 / 3, 3);
      expect(data.avgSalesCycleDays).toBeCloseTo(8, 0); // created 10d ago, closed 2d ago
      expect(data.bySource.find((s) => s.source === 'website')).toMatchObject({ won: 1, lost: 1 });
      expect(data.wonSeries.reduce((a, p) => a + p.count, 0)).toBe(2);
    });
  });

  describe('agents', () => {
    it('reports status counts, success rate, percentiles, tokens and cost coverage', async () => {
      const data = await get<AgentAnalytics>('agents');
      expect(data.pricingConfigured).toBe(false);
      expect(data.totals.executions).toBe(8);
      expect(data.totals.byStatus).toMatchObject({
        succeeded: 4, failed: 1, timed_out: 1, cancelled: 1, running: 1, queued: 0,
      });
      expect(data.totals.succeeded).toBe(4);
      expect(data.totals.failed).toBe(2); // failed + timed_out
      expect(data.totals.successRate).toBeCloseTo(4 / 6, 3); // finished = 4 + 1 + 1
      // durations of the 7 executions that have one: 50,100,200,300,400,1000,5000
      expect(data.totals.durationMs.p50).toBe(300);
      expect(data.totals.durationMs.p95).toBeGreaterThan(1000);
      expect(data.totals.inputTokens).toBe(201);
      expect(data.totals.outputTokens).toBe(51);
      expect(data.totals.totalTokens).toBe(252);
      expect(data.totals.costUsd).toBeCloseTo(0.071, 6);
      expect(data.totals.costCoverage).toEqual({ priced: 4, total: 8 });
      const alpha = data.byAgent.find((a) => a.agentId === agentA)!;
      expect(alpha).toMatchObject({ name: 'Alpha', executions: 5, succeeded: 4, failed: 1 });
      expect(alpha.successRate).toBeCloseTo(0.8, 3);
      expect(alpha.durationMs.p50).toBe(300);
      expect(data.byAgent.find((a) => a.agentId === agentB)).toMatchObject({ executions: 3 });
      expect(data.series.reduce((a, p) => a + p.total, 0)).toBe(8);
    });

    it('cost is null (not 0, not invented) when no execution has a cost estimate', async () => {
      const from = daysAgo(500).toISOString();
      const to = daysAgo(300).toISOString();
      const data = await get<AgentAnalytics>(
        `agents?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      expect(data.totals.executions).toBe(1);
      expect(data.totals.costUsd).toBeNull();
      expect(data.totals.costCoverage).toEqual({ priced: 0, total: 1 });
    });
  });

  describe('automation', () => {
    it('summarises workflow runs, grouped failure reasons and webhook delivery success', async () => {
      const data = await get<AutomationAnalytics>('automation');
      expect(data.workflows.runs).toBe(6);
      expect(data.workflows.byStatus).toMatchObject({ succeeded: 2, failed: 3, cancelled: 1 });
      expect(data.workflows.successRate).toBeCloseTo(2 / 5, 3);
      expect(data.workflows.failureReasons[0]).toEqual({ reason: 'Step http failed: 500', count: 2 });
      expect(data.workflows.failureReasons[1]).toEqual({ reason: 'Condition evaluation error', count: 1 });
      expect(data.workflows.byWorkflow[0]).toMatchObject({
        workflowId, name: 'Welcome flow', runs: 6, succeeded: 2, failed: 3,
      });
      expect(data.workflows.durationMs.p50).not.toBeNull();
      expect(data.workflows.series.reduce((a, p) => a + p.total, 0)).toBe(6);

      expect(data.webhooks.deliveries).toBe(6);
      expect(data.webhooks.byStatus).toMatchObject({ delivered: 3, failed: 2, pending: 1 });
      expect(data.webhooks.successRate).toBeCloseTo(3 / 5, 3);
      expect(data.webhooks.avgAttempts).toBeCloseTo(14 / 6, 1);
      expect(data.webhooks.failureReasons.map((r) => r.reason).sort()).toEqual(['HTTP 503', 'connect ECONNREFUSED']);
      expect(data.webhooks.byEvent.find((e) => e.event === 'lead.created')).toMatchObject({
        total: 3, delivered: 2, failed: 1,
      });
    });
  });

  describe('usage', () => {
    it('breaks AI requests down by model, agent and user with cost only where known', async () => {
      const data = await get<UsageAnalytics>('usage');
      expect(data.pricingConfigured).toBe(false);
      expect(data.totals).toMatchObject({
        requests: 4, successRequests: 3, errorRequests: 1,
        inputTokens: 310, outputTokens: 155, totalTokens: 465, pricedRequests: 2,
      });
      expect(data.totals.costUsd).toBeCloseTo(1.5, 6);
      const gptA = data.byModel.find((m) => m.model === 'gpt-a')!;
      expect(gptA).toMatchObject({ provider: 'openai', requests: 2, totalTokens: 450 });
      expect(gptA.costUsd).toBeCloseTo(1.5, 6);
      expect(data.byModel.find((m) => m.model === 'gpt-b')).toMatchObject({ requests: 2, costUsd: null });
      expect(data.byModel[0]?.model).toBe('gpt-a'); // ordered by tokens
      expect(data.byAgent.find((a) => a.agentId === agentA)).toMatchObject({ name: 'Alpha', requests: 2 });
      expect(data.byAgent.find((a) => a.agentId === null)).toMatchObject({ name: null, requests: 2 });
      expect(data.byUser.find((u) => u.userId === owner.user.id)).toMatchObject({
        name: 'Owen Owner', requests: 2, totalTokens: 450,
      });
      expect(data.byUser.find((u) => u.userId === null)).toMatchObject({ name: null });
      expect(data.series.reduce((a, p) => a + p.totalTokens, 0)).toBe(465);
    });

    it('compares the current month against plan limits and the budget', async () => {
      const { currentPeriod } = await get<UsageAnalytics>('usage');
      expect(currentPeriod.planTokenLimit).toBe(100_000);
      expect(currentPeriod.tokensUsed).toBe(465);
      expect(currentPeriod.percentOfPlan).toBeCloseTo(0.47, 1);
      expect(currentPeriod.budget.settings.hardStopEnabled).toBe(false);
      expect(currentPeriod.budget.tokens.used).toBe(465);
    });
  });

  describe('CSV export', () => {
    const exportCsv = (query: string, actor: Actor = owner) =>
      as(ctx, actor, orgId).get(`/api/v1/analytics/export?${query}`);

    it('exports the business series as text/csv attachment (not JSON-wrapped)', async () => {
      const res = await exportCsv('report=business&section=series&granularity=day');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="business-series-.*\.csv"$/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      const lines = res.text.trim().split('\r\n');
      expect(lines[0]).toBe('bucket,contacts_created,leads_created,conversations_created');
      const totals = lines.slice(1).reduce(
        (acc: number[], l) => {
          const [, c, le, co] = l.split(',').map(Number) as [number, number, number, number];
          return [(acc[0] ?? 0) + c, (acc[1] ?? 0) + le, (acc[2] ?? 0) + co];
        },
        [0, 0, 0],
      );
      expect(totals).toEqual([2, 9, 3]);
    });

    it('exports the business breakdown and the usage report', async () => {
      const breakdown = await exportCsv('report=business&section=breakdown');
      expect(breakdown.text).toContain('dimension,key,count');
      expect(breakdown.text).toContain('lead_status,won,2');
      expect(breakdown.text).toContain('funnel_reached,contacted,6');
      const usage = await exportCsv('report=usage&section=breakdown');
      expect(usage.text.split('\r\n')[0]).toBe('dimension,key,name,requests,input_tokens,output_tokens,total_tokens,cost_usd');
      expect(usage.text).toContain('model,openai:gpt-a,gpt-a,2,300,150,450,1.5');
      expect(usage.text).toContain('user,' + owner.user.id + ',Owen Owner,2,300,150,450,1.5');
      const series = await exportCsv('report=usage');
      expect(series.text.split('\r\n')[0]).toBe('bucket,requests,input_tokens,output_tokens,total_tokens,cost_usd');
    });

    it('neutralises formulas in exported names', async () => {
      const evil = await register(ctx, { firstName: '=cmd|calc', lastName: 'x' });
      const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
      await ctx.prisma.client.organizationMember.create({
        data: { organizationId: orgId, userId: evil.user.id, roleId: roles.find((r) => r.key === 'member')!.id, status: 'active' },
      });
      await ctx.prisma.client.aiRequestLog.create({
        data: {
          organizationId: orgId, userId: evil.user.id, provider: 'openai', model: 'gpt-b',
          operation: 'generate', status: 'success', inputTokens: 1, outputTokens: 1, createdAt: daysAgo(1),
        },
      });
      const res = await exportCsv('report=usage&section=breakdown');
      expect(res.text).toContain(`'=cmd|calc x`);
      expect(res.text).not.toMatch(/,=cmd/);
      await ctx.prisma.client.aiRequestLog.deleteMany({ where: { userId: evil.user.id } });
    });

    it('rejects unknown reports (400)', async () => {
      expect((await exportCsv('report=agents')).status).toBe(400);
      expect((await exportCsv('')).status).toBe(400);
    });
  });

  describe('permissions', () => {
    const paths = [
      'business', 'sales', 'agents', 'automation', 'usage', 'export?report=business',
    ];
    it.each(paths)('GET /analytics/%s needs analytics:read (403 without it, 200 for the member role)', async (path) => {
      const denied = await as(ctx, noAnalytics, orgId).get(`/api/v1/analytics/${path}`);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe(ErrorCode.FORBIDDEN);
      const allowed = await as(ctx, member, orgId).get(`/api/v1/analytics/${path}`);
      expect(allowed.status).toBe(200); // member role has analytics:read
    });
  });

  it('runs every report fast enough on its indexes (smoke: all 5 reports < 2s on the seeded data)', async () => {
    const started = Date.now();
    await Promise.all(['business', 'sales', 'agents', 'automation', 'usage'].map((p) => get(p)));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
