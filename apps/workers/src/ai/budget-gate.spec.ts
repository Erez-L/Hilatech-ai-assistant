import type { PrismaClient } from '@hilatech/database';
import { checkAiBudget } from './budget-gate';

function fakePrisma(input: {
  budget: {
    hardStopEnabled: boolean;
    monthlyTokenBudget: bigint | null;
    monthlyCostBudgetUsd: number | null;
  } | null;
  tokens?: number;
  cost?: number;
}) {
  const usageAggregate = jest.fn().mockResolvedValue({ _sum: { quantity: input.tokens ?? 0 } });
  const costAggregate = jest
    .fn()
    .mockResolvedValue({ _sum: { estimatedCostUsd: input.cost ?? 0 } });
  const prisma = {
    organizationBudget: { findUnique: jest.fn().mockResolvedValue(input.budget) },
    usageRecord: { aggregate: usageAggregate },
    aiRequestLog: { aggregate: costAggregate },
  } as unknown as PrismaClient;
  return { prisma, usageAggregate, costAggregate };
}

describe('checkAiBudget', () => {
  it('does not block (and reads no usage) without a budget row or with the hard stop off', async () => {
    const none = fakePrisma({ budget: null });
    expect(await checkAiBudget(none.prisma, 'org', { pricingConfigured: true })).toEqual({
      blocked: false,
    });
    const off = fakePrisma({
      budget: { hardStopEnabled: false, monthlyTokenBudget: 10n, monthlyCostBudgetUsd: 1 },
      tokens: 999,
      cost: 999,
    });
    expect(await checkAiBudget(off.prisma, 'org', { pricingConfigured: true })).toEqual({
      blocked: false,
    });
    expect(off.usageAggregate).not.toHaveBeenCalled();
  });

  it('blocks on the token budget once recorded usage reaches it', async () => {
    const below = fakePrisma({
      budget: { hardStopEnabled: true, monthlyTokenBudget: 100n, monthlyCostBudgetUsd: null },
      tokens: 99,
    });
    expect((await checkAiBudget(below.prisma, 'org', { pricingConfigured: false })).blocked).toBe(
      false,
    );
    const at = fakePrisma({
      budget: { hardStopEnabled: true, monthlyTokenBudget: 100n, monthlyCostBudgetUsd: null },
      tokens: 100,
    });
    expect(await checkAiBudget(at.prisma, 'org', { pricingConfigured: false })).toMatchObject({
      blocked: true,
      scope: 'tokens',
      used: 100,
      budget: 100,
    });
  });

  it('enforces the cost budget only when pricing is configured', async () => {
    const budget = { hardStopEnabled: true, monthlyTokenBudget: null, monthlyCostBudgetUsd: 5 };
    const unpriced = fakePrisma({ budget, cost: 50 });
    expect(
      (await checkAiBudget(unpriced.prisma, 'org', { pricingConfigured: false })).blocked,
    ).toBe(false);
    expect(unpriced.costAggregate).not.toHaveBeenCalled();

    const priced = fakePrisma({ budget, cost: 5 });
    expect(await checkAiBudget(priced.prisma, 'org', { pricingConfigured: true })).toMatchObject({
      blocked: true,
      scope: 'cost',
    });
  });
});
