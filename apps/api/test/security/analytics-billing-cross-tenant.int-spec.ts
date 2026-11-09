import { ErrorCode, type Role } from '@hilatech/contracts';
import request from 'supertest';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from '../setup/test-app';

/**
 * Tenant isolation for the Priority 5 endpoints (analytics reports, export, billing entitlements,
 * upgrade options, budget, alerts, checkout): a forged x-organization-id is refused (403 NOT_A_MEMBER),
 * and data seeded in org A never leaks into org B's aggregates (and vice versa).
 */
describe('Security: analytics & billing cross-tenant isolation', () => {
  let ctx: TestContext;
  let userA: Actor;
  let userB: Actor;
  let memberB: Actor;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userA = await register(ctx, { firstName: 'Alice', lastName: 'A' });
    userB = await register(ctx, { firstName: 'Bob', lastName: 'B' });
    memberB = await register(ctx, { firstName: 'Mel', lastName: 'B' });
    orgA = (await createOrganization(ctx, userA, 'Org A')).id;
    orgB = (await createOrganization(ctx, userB, 'Org B')).id;
    const rolesB = (await as(ctx, userB, orgB).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: { organizationId: orgB, userId: memberB.user.id, roleId: rolesB.find((r) => r.key === 'member')!.id, status: 'active' },
    });

    const db = ctx.prisma.client;
    const agent = await db.agent.create({ data: { organizationId: orgA, name: 'A-secret-agent', instructions: 'x' } });
    const wf = await db.workflow.create({ data: { organizationId: orgA, name: 'A-secret-flow', trigger: {}, steps: [] } });
    const hook = await db.webhook.create({
      data: { organizationId: orgA, url: 'https://a.example/h', events: [], encryptedSecret: 'x', secretLast4: '0000' },
    });
    await db.lead.createMany({
      data: [
        { organizationId: orgA, title: 'A1', status: 'won', source: 'website', value: 1234 },
        { organizationId: orgA, title: 'A2', status: 'new', source: 'website', value: 99 },
      ],
    });
    await db.contact.create({ data: { organizationId: orgA, firstName: 'A-contact' } });
    await db.conversation.create({ data: { organizationId: orgA, status: 'open', channel: 'web' } });
    await db.agentExecution.create({ data: { organizationId: orgA, agentId: agent.id, status: 'succeeded', input: {}, durationMs: 10, inputTokens: 5, outputTokens: 5 } });
    await db.workflowExecution.create({ data: { organizationId: orgA, workflowId: wf.id, status: 'failed', trigger: {}, input: {}, error: 'A-only failure' } });
    await db.webhookDelivery.create({ data: { organizationId: orgA, webhookId: hook.id, event: 'a.event', payload: {}, status: 'failed', lastError: 'A-only delivery error' } });
    await db.aiRequestLog.create({
      data: { organizationId: orgA, userId: userA.user.id, provider: 'openai', model: 'a-model', operation: 'generate', status: 'success', inputTokens: 10, outputTokens: 10 },
    });
    await db.usageRecord.create({
      data: {
        organizationId: orgA, metric: 'ai_tokens', quantity: BigInt(95_000),
        periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
        periodEnd: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)),
      },
    });
    // org A: budget + alerts (plan_tokens warning at 95%)
    await as(ctx, userA, orgA).put('/api/v1/billing/budget').send({ monthlyTokenBudget: 777, warnThresholdPct: 10 });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const GETS = [
    '/api/v1/analytics/business',
    '/api/v1/analytics/sales',
    '/api/v1/analytics/agents',
    '/api/v1/analytics/automation',
    '/api/v1/analytics/usage',
    '/api/v1/analytics/export?report=business',
    '/api/v1/analytics/export?report=usage&section=breakdown',
    '/api/v1/billing/entitlements',
    '/api/v1/billing/upgrade-options',
    '/api/v1/billing/budget',
    '/api/v1/billing/alerts',
  ];

  it.each(GETS)('GET %s with a forged x-organization-id for org B → 403 NOT_A_MEMBER', async (path) => {
    const res = await as(ctx, userA, orgB).get(path);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
  });

  it.each([
    ['PUT', '/api/v1/billing/budget', { monthlyTokenBudget: 1 }],
    ['POST', '/api/v1/billing/checkout', { plan: 'pro' }],
  ] as const)('%s %s with a forged x-organization-id → 403 and no write', async (method, path, body) => {
    const a = as(ctx, userA, orgB);
    const res = await (method === 'PUT' ? a.put(path) : a.post(path)).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
    expect(await ctx.prisma.client.organizationBudget.count({ where: { organizationId: orgB } })).toBe(0);
  });

  it.each(GETS)('GET %s requires authentication', async (path) => {
    const res = await request(ctx.http).get(path);
    expect(res.status).toBe(401);
  });

  it('org B sees zero of org A\'s analytics', async () => {
    const b = as(ctx, userB, orgB);
    const business = (await b.get('/api/v1/analytics/business')).body.data;
    expect(business.leads.created).toBe(0);
    expect(business.contacts.created).toBe(0);
    expect(business.conversations.created).toBe(0);
    const sales = (await b.get('/api/v1/analytics/sales')).body.data;
    expect(sales.pipeline).toEqual([]);
    expect(sales.closedInRange).toEqual([]);
    const agents = (await b.get('/api/v1/analytics/agents')).body.data;
    expect(agents.totals.executions).toBe(0);
    expect(agents.byAgent).toEqual([]);
    const automation = (await b.get('/api/v1/analytics/automation')).body.data;
    expect(automation.workflows.runs).toBe(0);
    expect(automation.workflows.failureReasons).toEqual([]);
    expect(automation.workflows.byWorkflow).toEqual([]);
    expect(automation.webhooks.deliveries).toBe(0);
    expect(automation.webhooks.byEvent).toEqual([]);
    const usage = (await b.get('/api/v1/analytics/usage')).body.data;
    expect(usage.totals.requests).toBe(0);
    expect(usage.byModel).toEqual([]);
    expect(usage.byUser).toEqual([]);
    expect(usage.currentPeriod.tokensUsed).toBe(0);
    expect(usage.currentPeriod.budget.settings.monthlyTokenBudget).toBeNull();
    for (const path of ['report=business&section=breakdown', 'report=usage&section=breakdown']) {
      const csv = (await b.get(`/api/v1/analytics/export?${path}`)).text;
      expect(csv).not.toMatch(/a-model|A-secret|Alice/);
    }
    expect(JSON.stringify([business, sales, agents, automation, usage])).not.toMatch(/A-secret|A-only|a-model|Alice/);
  });

  it('org A sees its own numbers (control)', async () => {
    const a = as(ctx, userA, orgA);
    expect((await a.get('/api/v1/analytics/business')).body.data.leads.created).toBe(2);
    expect((await a.get('/api/v1/analytics/agents')).body.data.byAgent[0].name).toBe('A-secret-agent');
    expect((await a.get('/api/v1/analytics/usage')).body.data.byModel[0].model).toBe('a-model');
  });

  it('budget settings, alerts and entitlements are per organization', async () => {
    const b = as(ctx, userB, orgB);
    const budget = (await b.get('/api/v1/billing/budget')).body.data;
    expect(budget.settings.monthlyTokenBudget).toBeNull();
    expect(budget.tokens.used).toBe(0);
    expect((await b.get('/api/v1/billing/alerts')).body.data).toEqual([]);
    const ent = (await b.get('/api/v1/billing/entitlements')).body.data;
    expect(ent.entitlements.find((e: { key: string }) => e.key === 'ai_tokens').used).toBe(0);

    const a = as(ctx, userA, orgA);
    expect((await a.get('/api/v1/billing/budget')).body.data.settings.monthlyTokenBudget).toBe(777);
    const alertsA = (await a.get('/api/v1/billing/alerts')).body.data as Array<{ organizationId: string }>;
    expect(alertsA.length).toBeGreaterThan(0);
    expect(alertsA.every((x) => x.organizationId === orgA)).toBe(true);

    // org B writes its own budget; org A's is untouched
    expect((await b.put('/api/v1/billing/budget').send({ monthlyTokenBudget: 42 })).status).toBe(200);
    expect((await a.get('/api/v1/billing/budget')).body.data.settings.monthlyTokenBudget).toBe(777);
    expect((await b.get('/api/v1/billing/budget')).body.data.settings.monthlyTokenBudget).toBe(42);
  });

  it('budget alert notifications reach only the organization\'s own billing managers', async () => {
    const notes = await ctx.prisma.client.notification.findMany({ where: { type: 'system' } });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.organizationId === orgA && n.userId === userA.user.id)).toBe(true);
  });

  it('a member without organization:billing:manage cannot write the budget or read alerts in their own org', async () => {
    const m = as(ctx, memberB, orgB);
    expect((await m.put('/api/v1/billing/budget').send({ monthlyTokenBudget: 1 })).status).toBe(403);
    expect((await m.get('/api/v1/billing/alerts')).status).toBe(403);
    expect((await m.post('/api/v1/billing/checkout').send({ plan: 'pro' })).status).toBe(403);
    expect((await m.get('/api/v1/billing/budget')).status).toBe(200);
    expect((await as(ctx, userB, orgB).get('/api/v1/billing/budget')).body.data.settings.monthlyTokenBudget).toBe(42);
  });
});
