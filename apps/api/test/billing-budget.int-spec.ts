import {
  type AssistantThread,
  AuditAction,
  type BudgetAlert,
  type BudgetStatus,
  type EntitlementsOverview,
  ErrorCode,
  type PlanCatalogEntry,
  type Role,
  type UpgradeOptions,
  type UsageSummary,
  PLAN_LIMITS,
} from '@hilatech/contracts';

import { BudgetService } from '../src/modules/billing/budget.service';
import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from './setup/test-app';

const monthStart = () =>
  new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
const monthEnd = () =>
  new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));

describe('Billing readiness: entitlements, budget, alerts, admission control', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgId: string;
  let threadId: string;
  let agentId: string;

  const api = (actor: Actor = owner) => as(ctx, actor, orgId);
  const setTokensUsed = async (tokens: number) => {
    await ctx.prisma.client.usageRecord.deleteMany({
      where: { organizationId: orgId, metric: 'ai_tokens' },
    });
    if (tokens > 0) {
      await ctx.prisma.client.usageRecord.create({
        data: {
          organizationId: orgId,
          metric: 'ai_tokens',
          quantity: BigInt(tokens),
          periodStart: monthStart(),
          periodEnd: monthEnd(),
        },
      });
    }
  };
  const putBudget = (body: Record<string, unknown>, actor: Actor = owner) =>
    api(actor).put('/api/v1/billing/budget').send(body);
  const sendMessage = (content = 'hello') =>
    api(member).post(`/api/v1/assistant/threads/${threadId}/messages`).send({ content });
  const requestLogs = () =>
    ctx.prisma.client.aiRequestLog.count({ where: { organizationId: orgId } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    orgId = (await createOrganization(ctx, owner, 'Billing Co')).id;
    const roles = (await api().get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
    expect(
      (
        await api()
          .post('/api/v1/ai/providers')
          .send({ provider: 'mock', name: 'Mock', defaultModel: 'mock-chat' })
      ).status,
    ).toBe(201);
    threadId = (
      (await api(member).post('/api/v1/assistant/threads').send({})).body.data as AssistantThread
    ).id;
    agentId = (
      await api()
        .post('/api/v1/agents')
        .send({ name: 'Budget agent', instructions: 'Answer briefly.', tools: [] })
    ).body.data.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('plan catalogue, entitlements and usage', () => {
    it('GET /billing/plans lists plans with limits and no invented prices', async () => {
      const res = await api().get('/api/v1/billing/plans');
      expect(res.status).toBe(200);
      const plans = res.body.data as PlanCatalogEntry[];
      expect(plans.map((p) => p.key)).toEqual(['free', 'starter', 'pro', 'enterprise']);
      expect(plans[0]).toMatchObject({ name: 'Free', rank: 0, limits: { seats: 2 } });
      expect(plans.every((p) => p.pricing.configured === false)).toBe(true);
    });

    it('documents and storage_mb come from the Document table, not from monthly UsageRecord sums', async () => {
      const db = ctx.prisma.client;
      const kb = await db.knowledgeBase.create({ data: { organizationId: orgId, name: 'KB' } });
      const doc = (n: number, sizeBytes: number) => ({
        organizationId: orgId,
        knowledgeBaseId: kb.id,
        title: `d${n}`,
        fileName: `d${n}.txt`,
        mimeType: 'text/plain',
        sizeBytes,
        storageKey: `test/${orgId}/${n}`,
      });
      await db.document.createMany({ data: [doc(1, 2 * 1024 * 1024), doc(2, 3 * 1024 * 1024)] });
      // A bogus usage counter must be ignored.
      await db.usageRecord.create({
        data: {
          organizationId: orgId,
          metric: 'documents',
          quantity: BigInt(999),
          periodStart: monthStart(),
          periodEnd: monthEnd(),
        },
      });
      await db.usageRecord.create({
        data: {
          organizationId: orgId,
          metric: 'storage_mb',
          quantity: BigInt(777),
          periodStart: monthStart(),
          periodEnd: monthEnd(),
        },
      });

      const usage = (await api().get('/api/v1/billing/usage')).body.data as UsageSummary;
      expect(usage.metrics.documents).toEqual({ used: 2, limit: 10 });
      expect(usage.metrics.storage_mb).toEqual({ used: 5, limit: 100 });

      const ent = (await api().get('/api/v1/billing/entitlements')).body
        .data as EntitlementsOverview;
      expect(ent.plan).toBe('free');
      const byKey = Object.fromEntries(ent.entitlements.map((e) => [e.key, e]));
      expect(byKey.documents).toMatchObject({
        used: 2,
        limit: 10,
        percent: 20,
        state: 'ok',
        basis: 'stock',
      });
      expect(byKey.storage_mb).toMatchObject({ used: 5, limit: 100, unit: 'mb' });
      expect(byKey.seats).toMatchObject({ used: 2, limit: 2, state: 'exceeded', enforced: true });
      expect(byKey.agents).toMatchObject({ used: 1, limit: 1, state: 'exceeded', enforced: false });
      expect(byKey.agent_executions).toMatchObject({ used: 0, limit: null });
      await db.usageRecord.deleteMany({
        where: { organizationId: orgId, metric: { in: ['documents', 'storage_mb'] } },
      });
      await db.document.deleteMany({ where: { organizationId: orgId } });
    });

    it('GET /billing/upgrade-options gives data only: pressure, higher plans, what they resolve, no payment', async () => {
      const res = await api().get('/api/v1/billing/upgrade-options');
      expect(res.status).toBe(200);
      const data = res.body.data as UpgradeOptions;
      expect(data.currentPlan).toBe('free');
      expect(data.pressure.map((p) => p.key)).toEqual(expect.arrayContaining(['seats', 'agents']));
      expect(data.options.map((o) => o.plan.key)).toEqual(['starter', 'pro', 'enterprise']);
      expect(data.options[0]?.resolves).toEqual(expect.arrayContaining(['seats', 'agents']));
      expect(data.options[0]?.limitDeltas.seats).toBe(3);
      expect(data.payment).toMatchObject({ configured: false, provider: null });
    });

    it('POST /billing/checkout answers 501 PAYMENT_NOT_CONFIGURED honestly (billing manager only)', async () => {
      const res = await api().post('/api/v1/billing/checkout').send({ plan: 'pro' });
      expect(res.status).toBe(501);
      expect(res.body.error.code).toBe(ErrorCode.PAYMENT_NOT_CONFIGURED);
      expect(
        (await api(member).post('/api/v1/billing/checkout').send({ plan: 'pro' })).status,
      ).toBe(403);
      expect((await api().post('/api/v1/billing/checkout').send({ plan: 'platinum' })).status).toBe(
        400,
      );
      // nothing changed
      const sub = await ctx.prisma.client.subscription.findUnique({
        where: { organizationId: orgId },
      });
      expect(sub?.plan).toBe('free');
    });
  });

  describe('budget settings', () => {
    it('defaults to no budget, readable by any member', async () => {
      const res = await api(member).get('/api/v1/billing/budget');
      expect(res.status).toBe(200);
      const status = res.body.data as BudgetStatus;
      expect(status.settings).toMatchObject({
        monthlyTokenBudget: null,
        monthlyCostBudgetUsd: null,
        warnThresholdPct: 80,
        hardStopEnabled: false,
        updatedAt: null,
      });
      expect(status.tokens).toMatchObject({ budget: null, level: 'ok' });
      expect(status.blocked).toBe(false);
    });

    it('PUT needs organization:billing:manage, validates input and audits the change', async () => {
      expect((await putBudget({ monthlyTokenBudget: 1000 }, member)).status).toBe(403);
      expect((await putBudget({})).status).toBe(400);
      expect((await putBudget({ monthlyTokenBudget: -5 })).status).toBe(400);
      expect((await putBudget({ warnThresholdPct: 0 })).status).toBe(400);
      expect((await putBudget({ warnThresholdPct: 101 })).status).toBe(400);
      expect((await putBudget({ nonsense: true })).status).toBe(400);
      const noBudget = await putBudget({ hardStopEnabled: true });
      expect(noBudget.status).toBe(400);
      expect(noBudget.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

      const ok = await putBudget({
        monthlyTokenBudget: 10_000,
        warnThresholdPct: 75,
        hardStopEnabled: false,
      });
      expect(ok.status).toBe(200);
      expect((ok.body.data as BudgetStatus).settings).toMatchObject({
        monthlyTokenBudget: 10_000,
        warnThresholdPct: 75,
        hardStopEnabled: false,
        updatedById: owner.user.id,
      });
      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { organizationId: orgId, action: AuditAction.BILLING_BUDGET_UPDATED },
      });
      expect(audit).not.toBeNull();
      // null clears, omitted fields stay
      const cleared = await putBudget({ monthlyTokenBudget: null });
      expect((cleared.body.data as BudgetStatus).settings).toMatchObject({
        monthlyTokenBudget: null,
        warnThresholdPct: 75,
      });
      await putBudget({ monthlyTokenBudget: 10_000 });
    });
  });

  describe('alerts + notifications', () => {
    const notificationsFor = (userId: string) =>
      ctx.prisma.client.notification.findMany({
        where: { organizationId: orgId, userId, type: 'system' },
        orderBy: { createdAt: 'asc' },
      });

    it('crossing the warn threshold raises ONE alert record and notifies billing managers only', async () => {
      await setTokensUsed(7_600); // budget 10_000, warn 75%
      const status = (await putBudget({ warnThresholdPct: 75 })).body.data as BudgetStatus;
      expect(status.tokens).toMatchObject({ used: 7_600, percent: 76, level: 'warning' });

      // reading again must not duplicate
      await api().get('/api/v1/billing/budget');
      await api().get('/api/v1/billing/budget');

      const alerts = (await api().get('/api/v1/billing/alerts')).body.data as BudgetAlert[];
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        organizationId: orgId,
        scope: 'budget_tokens',
        kind: 'warning',
        used: 7_600,
        limit: 10_000,
        thresholdPct: 75,
      });
      const ownerNotes = await notificationsFor(owner.user.id);
      expect(ownerNotes).toHaveLength(1);
      expect(ownerNotes[0]?.data).toMatchObject({
        kind: 'budget_alert',
        scope: 'budget_tokens',
        level: 'warning',
      });
      expect(ownerNotes[0]?.link).toBe('/settings/billing');
      // the plain member cannot manage billing: no notification, no alert listing
      expect(await notificationsFor(member.user.id)).toHaveLength(0);
      expect((await api(member).get('/api/v1/billing/alerts')).status).toBe(403);
    });

    it('reaching 100% adds the exceeded alert (once) and a second notification', async () => {
      await setTokensUsed(10_050);
      await api().get('/api/v1/billing/budget');
      await api().get('/api/v1/billing/budget');
      const res = await api().get('/api/v1/billing/alerts');
      const alerts = res.body.data as BudgetAlert[];
      expect(alerts.map((a) => `${a.scope}/${a.kind}`).sort()).toEqual([
        'budget_tokens/exceeded',
        'budget_tokens/warning',
      ]);
      expect(res.body.meta.total).toBe(2);
      const notes = await notificationsFor(owner.user.id);
      expect(notes.map((n) => (n.data as { level: string }).level)).toEqual([
        'warning',
        'exceeded',
      ]);
    });
  });

  describe('admission control before any provider call', () => {
    beforeEach(async () => {
      await putBudget({ monthlyTokenBudget: 10_000, hardStopEnabled: false });
    });

    it('soft mode (hard stop off) never blocks, even when over budget', async () => {
      await setTokensUsed(50_000);
      const res = await sendMessage('soft mode still answers');
      expect(res.status).toBe(200);
      expect(res.body.data.message.content).toBe('mock: soft mode still answers');
    });

    it('assistant: hard stop + exhausted budget → 402 BUDGET_EXCEEDED, no provider call, nothing persisted', async () => {
      await setTokensUsed(10_000);
      await putBudget({ hardStopEnabled: true });
      const logsBefore = await requestLogs();
      const messagesBefore = await ctx.prisma.client.assistantMessage.count({
        where: { threadId },
      });

      const res = await sendMessage('should be refused');
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe(ErrorCode.BUDGET_EXCEEDED);
      expect(res.body.error.details).toMatchObject({
        scope: 'budget_tokens',
        reason: 'exhausted',
        used: 10_000,
        budget: 10_000,
      });
      expect(await requestLogs()).toBe(logsBefore); // the provider was never called
      expect(await ctx.prisma.client.assistantMessage.count({ where: { threadId } })).toBe(
        messagesBefore,
      );

      const status = (await api().get('/api/v1/billing/budget')).body.data as BudgetStatus;
      expect(status.blocked).toBe(true);
    });

    it('assistant: the SSE variant is refused with the same JSON error before the stream opens', async () => {
      await putBudget({ hardStopEnabled: true });
      const res = await api(member)
        .post(`/api/v1/assistant/threads/${threadId}/messages`)
        .set('Accept', 'text/event-stream')
        .send({ content: 'stream me' });
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe(ErrorCode.BUDGET_EXCEEDED);
    });

    it('agents: sync and async executes are refused with no execution row created', async () => {
      await putBudget({ hardStopEnabled: true });
      const before = await ctx.prisma.client.agentExecution.count({
        where: { organizationId: orgId },
      });
      for (const mode of ['sync', 'async']) {
        const res = await api(member)
          .post(`/api/v1/agents/${agentId}/execute`)
          .send({ input: 'x', mode });
        expect(res.status).toBe(402);
        expect(res.body.error.code).toBe(ErrorCode.BUDGET_EXCEEDED);
      }
      expect(
        await ctx.prisma.client.agentExecution.count({ where: { organizationId: orgId } }),
      ).toBe(before);
    });

    it('raising the budget re-opens the gate; runs reconcile and release their reservation', async () => {
      await putBudget({ monthlyTokenBudget: 200_000 });
      const logsBefore = await requestLogs();
      const chat = await sendMessage('now it works');
      expect(chat.status).toBe(200);
      const exec = await api(member)
        .post(`/api/v1/agents/${agentId}/execute`)
        .send({ input: 'hi', mode: 'sync' });
      expect(exec.status).toBe(200);
      expect(exec.body.data.status).toBe('succeeded');
      expect(await requestLogs()).toBeGreaterThan(logsBefore);

      const budget = ctx.app.get(BudgetService);
      const reservations = (
        budget as unknown as {
          reservations: { outstanding(o: string): Promise<{ tokens: number }> };
        }
      ).reservations;
      expect((await reservations.outstanding(orgId)).tokens).toBe(0);
    });

    it('a request whose estimate does not fit the remaining headroom is refused (would_exceed)', async () => {
      // ~4k + 1.5k overhead per estimate; leave only 3k of headroom
      // lift the plan allowance so only the budget is in play
      await ctx.prisma.client.subscription.update({
        where: { organizationId: orgId },
        data: { limits: { ...PLAN_LIMITS.free, aiTokensPerMonth: 10_000_000 } },
      });
      await setTokensUsed(197_000);
      await putBudget({ monthlyTokenBudget: 200_000, hardStopEnabled: true });
      const res = await sendMessage('too big for the remainder');
      expect(res.status).toBe(402);
      expect(res.body.error.details).toMatchObject({
        scope: 'budget_tokens',
        reason: 'would_exceed',
      });
    });

    it('cost-only budget without any configured pricing is reported unenforceable and does not block', async () => {
      await setTokensUsed(0);
      await putBudget({
        monthlyTokenBudget: null,
        monthlyCostBudgetUsd: 0.01,
        hardStopEnabled: true,
      });
      const status = (await api().get('/api/v1/billing/budget')).body.data as BudgetStatus;
      expect(status.cost).toMatchObject({ enforceable: false, usedUsd: null, level: 'ok' });
      expect(status.cost.note).toMatch(/pricing/i);
      expect((await sendMessage('cost blind')).status).toBe(200);
      await putBudget({ monthlyCostBudgetUsd: null, monthlyTokenBudget: 10_000 });
    });
  });

  describe('atomic reservations (Redis)', () => {
    it('two concurrent admissions cannot both fit the same headroom; release frees it', async () => {
      await setTokensUsed(0);
      await putBudget({ monthlyTokenBudget: 8_000, hardStopEnabled: true });
      const budget = ctx.app.get(BudgetService);
      const results = await Promise.allSettled([
        budget.admit(orgId, { tokens: 5_000, costUsd: null }),
        budget.admit(orgId, { tokens: 5_000, costUsd: null }),
        budget.admit(orgId, { tokens: 5_000, costUsd: null }),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(refused).toHaveLength(2);
      expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
        code: ErrorCode.BUDGET_EXCEEDED,
      });
      await (ok[0] as PromiseFulfilledResult<{ release(): Promise<void> }>).value.release();
      const again = await budget.admit(orgId, { tokens: 5_000, costUsd: null });
      await again.release();
    });
  });
});
