import { type BudgetStatus, ErrorCode, type UsageAnalytics } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from './setup/test-app';

/** Cost budgets only exist where model pricing is configured (AI_PRICING_JSON). */
describe('Cost budget with configured pricing', () => {
  const previous = process.env.AI_PRICING_JSON;
  let ctx: TestContext;
  let owner: Actor;
  let orgId: string;
  let threadId: string;

  beforeAll(async () => {
    process.env.AI_PRICING_JSON = JSON.stringify([
      { provider: 'mock', model: 'mock-chat', inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
    ]);
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx);
    orgId = (await createOrganization(ctx, owner, 'Cost Co')).id;
    await as(ctx, owner, orgId)
      .post('/api/v1/ai/providers')
      .send({ provider: 'mock', name: 'Mock', defaultModel: 'mock-chat' });
    threadId = (await as(ctx, owner, orgId).post('/api/v1/assistant/threads').send({})).body.data
      .id;
  });

  afterAll(async () => {
    await ctx.close();
    if (previous === undefined) delete process.env.AI_PRICING_JSON;
    else process.env.AI_PRICING_JSON = previous;
  });

  it('measures cost from priced requests, warns, and hard-stops on the cost budget', async () => {
    const api = as(ctx, owner, orgId);
    // One call is estimated at ~5.6k tokens (4096 reserved for output) ≈ $0.0097 at these prices; budget $0.05.
    const put = await api
      .put('/api/v1/billing/budget')
      .send({ monthlyCostBudgetUsd: 0.05, hardStopEnabled: true });
    expect(put.status).toBe(200);
    expect((put.body.data as BudgetStatus).cost).toMatchObject({
      enforceable: true,
      usedUsd: 0,
      level: 'ok',
    });

    const ok = await api
      .post(`/api/v1/assistant/threads/${threadId}/messages`)
      .send({ content: 'priced call' });
    expect(ok.status).toBe(200);
    const logged = await ctx.prisma.client.aiRequestLog.findFirst({
      where: { organizationId: orgId },
    });
    expect(Number(logged?.estimatedCostUsd)).toBeGreaterThan(0);

    let status = (await api.get('/api/v1/billing/budget')).body.data as BudgetStatus;
    expect(status.cost.usedUsd).toBeGreaterThan(0);
    expect(status.cost.pricedRequests).toBeGreaterThan(0);

    // push recorded cost over the budget
    await ctx.prisma.client.aiRequestLog.create({
      data: {
        organizationId: orgId,
        provider: 'mock',
        model: 'mock-chat',
        operation: 'generate',
        status: 'success',
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0.05,
      },
    });
    status = (await api.get('/api/v1/billing/budget')).body.data as BudgetStatus;
    expect(status.cost.level).toBe('exceeded');
    expect(status.blocked).toBe(true);

    const refused = await api
      .post(`/api/v1/assistant/threads/${threadId}/messages`)
      .send({ content: 'blocked' });
    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe(ErrorCode.BUDGET_EXCEEDED);
    expect(refused.body.error.details).toMatchObject({ scope: 'budget_cost' });

    const alerts = (await api.get('/api/v1/billing/alerts')).body.data as Array<{
      scope: string;
      kind: string;
    }>;
    expect(alerts.map((a) => `${a.scope}/${a.kind}`)).toEqual(
      expect.arrayContaining(['budget_cost/warning', 'budget_cost/exceeded']),
    );

    const usage = (await api.get('/api/v1/analytics/usage')).body.data as UsageAnalytics;
    expect(usage.pricingConfigured).toBe(true);
    expect(usage.totals.costUsd).toBeGreaterThan(0.05);
    expect(usage.currentPeriod.budget.cost.level).toBe('exceeded');
  });
});
