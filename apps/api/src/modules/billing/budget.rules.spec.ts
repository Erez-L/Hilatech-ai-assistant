import {
  type BudgetSettingsLike,
  admissionCaps,
  budgetLevel,
  decideAdmission,
  dueAlerts,
  entitlementState,
  estimateRequest,
  percentOf,
  toMicroUsd,
} from './budget.rules';

const settings = (over: Partial<BudgetSettingsLike> = {}): BudgetSettingsLike => ({
  monthlyTokenBudget: 1000,
  monthlyCostBudgetUsd: null,
  warnThresholdPct: 80,
  hardStopEnabled: true,
  ...over,
});

describe('budgetLevel / entitlementState / percentOf', () => {
  it('is ok below the warn threshold, warning from it, exceeded at the limit', () => {
    expect(budgetLevel(799, 1000, 80)).toBe('ok');
    expect(budgetLevel(800, 1000, 80)).toBe('warning');
    expect(budgetLevel(999, 1000, 80)).toBe('warning');
    expect(budgetLevel(1000, 1000, 80)).toBe('exceeded');
    expect(budgetLevel(5000, null)).toBe('ok');
    expect(budgetLevel(5, 0)).toBe('ok');
  });

  it('honours a custom warn threshold', () => {
    expect(budgetLevel(500, 1000, 50)).toBe('warning');
    expect(budgetLevel(499, 1000, 50)).toBe('ok');
  });

  it('entitlement state uses 80% and treats limit 0 as exceeded once used', () => {
    expect(entitlementState(79, 100)).toBe('ok');
    expect(entitlementState(80, 100)).toBe('warning');
    expect(entitlementState(100, 100)).toBe('exceeded');
    expect(entitlementState(1, 0)).toBe('exceeded');
    expect(entitlementState(0, 0)).toBe('ok');
    expect(entitlementState(1e9, null)).toBe('ok');
  });

  it('percentOf rounds to two decimals and is null without a limit', () => {
    expect(percentOf(1, 3)).toBe(33.33);
    expect(percentOf(5, null)).toBeNull();
    expect(percentOf(5, 0)).toBeNull();
  });
});

describe('estimateRequest', () => {
  it('adds prompt overhead and the output reserve, ~4 chars per token', () => {
    const e = estimateRequest({ textChars: 4000, outputReserveTokens: 1000 });
    expect(e.inputTokens).toBe(1000 + 1500);
    expect(e.outputTokens).toBe(1000);
    expect(e.total).toBe(3500);
  });

  it('never reserves more than the run may consume and keeps the split consistent', () => {
    const e = estimateRequest({ textChars: 400_000, outputReserveTokens: 4096, maxTokens: 10_000 });
    expect(e.total).toBe(10_000);
    expect(e.inputTokens + e.outputTokens).toBe(10_000);
  });
});

describe('admissionCaps', () => {
  it('is the remaining headroom, never negative, null when not budgeted', () => {
    expect(admissionCaps(settings(), { tokensUsed: 400, costUsedUsd: null })).toEqual({
      tokens: 600,
      costMicroUsd: null,
    });
    expect(admissionCaps(settings(), { tokensUsed: 1500, costUsedUsd: null }).tokens).toBe(0);
    expect(
      admissionCaps(settings({ monthlyTokenBudget: null }), { tokensUsed: 9, costUsedUsd: null }),
    ).toEqual({ tokens: null, costMicroUsd: null });
  });

  it('cost headroom needs measurable cost (pricing configured)', () => {
    const s = settings({ monthlyTokenBudget: null, monthlyCostBudgetUsd: 10 });
    expect(admissionCaps(s, { tokensUsed: 0, costUsedUsd: null }).costMicroUsd).toBeNull();
    expect(admissionCaps(s, { tokensUsed: 0, costUsedUsd: 2.5 }).costMicroUsd).toBe(
      toMicroUsd(7.5),
    );
  });
});

describe('decideAdmission', () => {
  const none = { tokens: 0, costMicroUsd: 0 };
  it('allows when the estimate fits into the headroom after outstanding reservations', () => {
    expect(decideAdmission({ tokens: 600, costMicroUsd: null }, none, { tokens: 600, costMicroUsd: null })).toEqual({
      allowed: true,
    });
    expect(
      decideAdmission({ tokens: 600, costMicroUsd: null }, { tokens: 300, costMicroUsd: 0 }, { tokens: 301, costMicroUsd: null }),
    ).toEqual({ allowed: false, scope: 'tokens', reason: 'would_exceed' });
  });

  it('refuses everything once exhausted, even a tiny request', () => {
    expect(decideAdmission({ tokens: 0, costMicroUsd: null }, none, { tokens: 1, costMicroUsd: null })).toEqual({
      allowed: false,
      scope: 'tokens',
      reason: 'exhausted',
    });
  });

  it('cost: unpriced models are only refused by an exhausted cost budget', () => {
    expect(decideAdmission({ tokens: null, costMicroUsd: 5 }, none, { tokens: 100, costMicroUsd: null })).toEqual({
      allowed: true,
    });
    expect(decideAdmission({ tokens: null, costMicroUsd: 0 }, none, { tokens: 100, costMicroUsd: null })).toEqual({
      allowed: false,
      scope: 'cost',
      reason: 'exhausted',
    });
    expect(decideAdmission({ tokens: null, costMicroUsd: 5 }, none, { tokens: 1, costMicroUsd: 6 })).toEqual({
      allowed: false,
      scope: 'cost',
      reason: 'would_exceed',
    });
  });

  it('no caps = always allowed', () => {
    expect(decideAdmission({ tokens: null, costMicroUsd: null }, none, { tokens: 1e12, costMicroUsd: 1e12 })).toEqual({ allowed: true });
  });
});

describe('dueAlerts', () => {
  it('raises nothing below the threshold or without a limit', () => {
    expect(dueAlerts('budget_tokens', 79, 100, 80)).toEqual([]);
    expect(dueAlerts('budget_tokens', 10, null, 80)).toEqual([]);
    expect(dueAlerts('budget_tokens', 10, 0, 80)).toEqual([]);
  });
  it('warning at the threshold, both warning and exceeded at 100%', () => {
    expect(dueAlerts('budget_tokens', 80, 100, 80).map((a) => a.kind)).toEqual(['warning']);
    const both = dueAlerts('plan_tokens', 120, 100, 80);
    expect(both.map((a) => [a.kind, a.thresholdPct])).toEqual([
      ['warning', 80],
      ['exceeded', 100],
    ]);
  });
});
