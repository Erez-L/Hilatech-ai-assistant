import { PricingTable } from '@hilatech/ai-engine';
import { ALL_PERMISSIONS, ErrorCode, PLAN_LIMITS } from '@hilatech/contracts';

import { AppException } from '../../common/errors/app.exception';
import {
  createAuditMock,
  createLoggerMock,
  createPrismaMock,
} from '../../test-utils/prisma.mock';
import { InMemoryReservationStore } from './budget-reservations';
import { BudgetService, alertText } from './budget.service';
import { EntitlementsService } from './entitlements.service';

const ORG = '22222222-2222-4222-8222-222222222222';
const tenant = {
  organizationId: ORG,
  userId: 'u1',
  memberId: 'm',
  roleId: 'r',
  roleKey: 'owner',
  permissions: ALL_PERMISSIONS,
};
const META = { ipAddress: null, userAgent: null, requestId: null };

function build(opts: { pricing?: PricingTable } = {}) {
  const { service: prisma, client } = createPrismaMock();
  const notifications = { notify: jest.fn().mockResolvedValue(null) };
  const audit = createAuditMock();
  const store = new InMemoryReservationStore();
  const service = new BudgetService(
    prisma,
    new EntitlementsService(prisma),
    opts.pricing ?? new PricingTable(),
    store as never,
    notifications as never,
    audit as never,
    createLoggerMock() as never,
  );
  client.subscription.findUnique.mockResolvedValue({ plan: 'pro', limits: PLAN_LIMITS.pro });
  client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(0) } });
  client.aiRequestLog.aggregate.mockResolvedValue({
    _sum: { estimatedCostUsd: null },
    _count: { _all: 0 },
  });
  client.aiRequestLog.count.mockResolvedValue(0);
  return { service, client, notifications, audit, store };
}

function budgetRow(over: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    monthlyTokenBudget: BigInt(10_000),
    monthlyCostBudgetUsd: null,
    warnThresholdPct: 80,
    hardStopEnabled: true,
    updatedById: 'u1',
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

describe('BudgetService.admit', () => {
  it('is a no-op without a budget row or with hard stop off (no Redis, no DB writes)', async () => {
    const { service, client, store } = build();
    client.organizationBudget.findUnique.mockResolvedValue(null);
    const spy = jest.spyOn(store, 'tryReserve');
    const r1 = await service.admit(ORG, { tokens: 1e9, costUsd: null });
    await r1.release();
    client.organizationBudget.findUnique.mockResolvedValue(budgetRow({ hardStopEnabled: false }));
    await service.admit(ORG, { tokens: 1e9, costUsd: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses with 402 BUDGET_EXCEEDED when the token budget is used up (before any provider call)', async () => {
    const { service, client } = build();
    client.organizationBudget.findUnique.mockResolvedValue(budgetRow());
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(10_000) } });
    const error = (await service
      .admit(ORG, { tokens: 10, costUsd: null })
      .catch((e: unknown) => e)) as AppException;
    expect(error).toBeInstanceOf(AppException);
    expect(error.getStatus()).toBe(402);
    expect(error.code).toBe(ErrorCode.BUDGET_EXCEEDED);
    expect(error.details).toMatchObject({ scope: 'budget_tokens', reason: 'exhausted', used: 10_000, budget: 10_000 });
  });

  it('reserves headroom: a second concurrent request that no longer fits is refused until the first releases', async () => {
    const { service, client } = build();
    client.organizationBudget.findUnique.mockResolvedValue(budgetRow());
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(4_000) } }); // 6000 left
    const first = await service.admit(ORG, { tokens: 4_000, costUsd: null });
    await expect(service.admit(ORG, { tokens: 4_000, costUsd: null })).rejects.toMatchObject({
      code: ErrorCode.BUDGET_EXCEEDED,
      details: { reason: 'would_exceed' },
    });
    await first.release();
    await first.release(); // idempotent
    await expect(service.admit(ORG, { tokens: 4_000, costUsd: null })).resolves.toBeDefined();
  });

  it('enforces a cost budget only where pricing exists', async () => {
    const pricing = new PricingTable([
      { provider: 'openai', model: 'm', inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
    ]);
    const { service, client } = build({ pricing });
    client.organizationBudget.findUnique.mockResolvedValue(
      budgetRow({ monthlyTokenBudget: null, monthlyCostBudgetUsd: 1 }),
    );
    client.aiRequestLog.aggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: '0.999999' },
      _count: { _all: 3 },
    });
    await expect(service.admit(ORG, { tokens: 10, costUsd: 0.5 })).rejects.toMatchObject({
      code: ErrorCode.BUDGET_EXCEEDED,
      details: { scope: 'budget_cost', reason: 'would_exceed' },
    });
    // An unpriced model (estimate null) still fits into the remaining cent.
    await expect(service.admit(ORG, { tokens: 10, costUsd: null })).resolves.toBeDefined();
  });

  it('without any pricing a cost-only budget cannot be enforced (honest: no refusal, status says so)', async () => {
    const { service, client } = build();
    client.organizationBudget.findUnique.mockResolvedValue(
      budgetRow({ monthlyTokenBudget: null, monthlyCostBudgetUsd: 1 }),
    );
    await expect(service.admit(ORG, { tokens: 1e6, costUsd: null })).resolves.toBeDefined();
    const status = await service.status(ORG);
    expect(status.cost).toMatchObject({
      enforceable: false,
      usedUsd: null,
      percent: null,
      level: 'ok',
    });
    expect(status.cost.note).toMatch(/pricing/i);
    expect(status.blocked).toBe(false);
  });
});

describe('BudgetService.status / update', () => {
  it('reports levels, percent and blocked for an exhausted hard-stop budget', async () => {
    const { service, client } = build();
    client.organizationBudget.findUnique.mockResolvedValue(budgetRow());
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(8_500) } });
    const warn = await service.status(ORG);
    expect(warn.tokens).toMatchObject({ used: 8_500, budget: 10_000, percent: 85, level: 'warning' });
    expect(warn.blocked).toBe(false);
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(10_001) } });
    expect((await service.status(ORG)).blocked).toBe(true);
  });

  it('rejects hard stop without anything to enforce, and audits successful updates', async () => {
    const { service, client, audit } = build();
    client.organizationBudget.findUnique.mockResolvedValue(null);
    await expect(service.update(tenant, { hardStopEnabled: true }, META)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    await service.update(tenant, { monthlyTokenBudget: 5_000, hardStopEnabled: true }, META);
    expect(client.organizationBudget.upsert).toHaveBeenCalledTimes(1);
    const arg = client.organizationBudget.upsert.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ organizationId: ORG });
    expect(arg.create).toMatchObject({ organizationId: ORG, monthlyTokenBudget: BigInt(5_000), hardStopEnabled: true });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.budget_updated', organizationId: ORG }),
    );
  });

  it('null clears a budget while omitted fields keep their value', async () => {
    const { service, client } = build();
    client.organizationBudget.findUnique.mockResolvedValue(
      budgetRow({ monthlyCostBudgetUsd: '12.5', hardStopEnabled: false }),
    );
    await service.update(tenant, { monthlyTokenBudget: null }, META);
    const data = client.organizationBudget.upsert.mock.calls[0]?.[0].update;
    expect(data.monthlyTokenBudget).toBeNull();
    expect(Number(data.monthlyCostBudgetUsd)).toBe(12.5);
  });
});

describe('BudgetService alerts', () => {
  const created = (scope: string, kind: string, used: number, limit: number, pct: number) => ({
    id: `${scope}-${kind}`,
    organizationId: ORG,
    periodStart: new Date('2026-11-01T00:00:00Z'),
    scope,
    kind,
    used,
    limit,
    thresholdPct: pct,
    createdAt: new Date(),
  });

  it('creates warning alerts once and notifies only members who can manage billing', async () => {
    const { service, client, notifications } = build();
    client.organizationBudget.findUnique.mockResolvedValue(budgetRow());
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(8_100) } });
    client.budgetAlert.createManyAndReturn.mockResolvedValue([
      created('budget_tokens', 'warning', 8100, 10000, 80),
    ]);
    client.organizationMember.findMany.mockResolvedValue([{ userId: 'owner' }, { userId: 'admin' }]);

    await service.evaluate(ORG);

    const data = client.budgetAlert.createManyAndReturn.mock.calls[0]?.[0];
    expect(data.skipDuplicates).toBe(true);
    expect(data.data.map((d: { scope: string; kind: string }) => `${d.scope}/${d.kind}`)).toEqual([
      'budget_tokens/warning',
    ]);
    expect(client.organizationMember.findMany.mock.calls[0]?.[0].where).toMatchObject({
      organizationId: ORG,
      role: { permissions: { has: 'organization:billing:manage' } },
    });
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORG,
      userId: 'owner',
      type: 'system',
      data: { kind: 'budget_alert', scope: 'budget_tokens', level: 'warning' },
    });
  });

  it('sends nothing when every due alert already exists (de-duplicated by the unique key)', async () => {
    const { service, client, notifications } = build();
    client.organizationBudget.findUnique.mockResolvedValue(budgetRow());
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(9_000) } });
    client.budgetAlert.createManyAndReturn.mockResolvedValue([]);
    await service.evaluate(ORG);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('one notification per scope: exceeded supersedes warning created in the same pass', async () => {
    const { service, client, notifications } = build();
    client.organizationBudget.findUnique.mockResolvedValue(budgetRow());
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(12_000) } });
    client.budgetAlert.createManyAndReturn.mockResolvedValue([
      created('budget_tokens', 'warning', 12000, 10000, 80),
      created('budget_tokens', 'exceeded', 12000, 10000, 100),
    ]);
    client.organizationMember.findMany.mockResolvedValue([{ userId: 'owner' }]);
    await service.evaluate(ORG);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify.mock.calls[0]?.[0].data).toMatchObject({ level: 'exceeded' });
  });

  it('also alerts on the plan allowance (plan_tokens) even without a budget row', async () => {
    const { service, client } = build();
    client.organizationBudget.findUnique.mockResolvedValue(null);
    client.subscription.findUnique.mockResolvedValue({ plan: 'free', limits: PLAN_LIMITS.free });
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(90_000) } }); // 100k plan
    client.budgetAlert.createManyAndReturn.mockResolvedValue([]);
    await service.evaluate(ORG);
    const rows = client.budgetAlert.createManyAndReturn.mock.calls[0]?.[0].data;
    expect(rows).toEqual([expect.objectContaining({ scope: 'plan_tokens', kind: 'warning', limit: 100_000 })]);
  });

  it('never throws from reconcile (alert failure must not fail the AI request)', async () => {
    const { service, client } = build();
    client.organizationBudget.findUnique.mockRejectedValue(new Error('db down'));
    await expect(service.reconcile(ORG)).resolves.toBeUndefined();
  });

  it('alertText describes warning vs exceeded', () => {
    expect(alertText({ scope: 'budget_cost', kind: 'warning', thresholdPct: 80 }).title).toMatch(/80%/);
    expect(alertText({ scope: 'plan_tokens', kind: 'exceeded', thresholdPct: 100 }).title).toMatch(/used up/);
  });
});
