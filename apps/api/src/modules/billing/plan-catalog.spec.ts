import { PLAN_LIMITS, type EntitlementUsage } from '@hilatech/contracts';

import { buildUpgradeOptions, planCatalog } from './plan-catalog';

const row = (key: EntitlementUsage['key'], used: number, limit: number): EntitlementUsage => ({
  key,
  label: key,
  unit: 'count',
  used,
  limit,
  percent: Math.round((used / limit) * 100),
  state: used >= limit ? 'exceeded' : 'warning',
  basis: 'stock',
  enforced: true,
});

describe('plan catalogue', () => {
  it('lists plans in ascending order with honest "no pricing configured"', () => {
    const catalog = planCatalog();
    expect(catalog.map((p) => p.key)).toEqual(['free', 'starter', 'pro', 'enterprise']);
    expect(catalog.map((p) => p.rank)).toEqual([0, 1, 2, 3]);
    expect(catalog.every((p) => p.pricing.configured === false)).toBe(true);
    expect(JSON.stringify(catalog)).not.toMatch(/price"\s*:\s*\d/);
  });
});

describe('buildUpgradeOptions', () => {
  it('offers only higher plans with deltas and what each would resolve', () => {
    const pressure = [row('seats', 2, 2), row('storage_mb', 90, 100)];
    const options = buildUpgradeOptions('free', PLAN_LIMITS.free, pressure);
    expect(options.map((o) => o.plan.key)).toEqual(['starter', 'pro', 'enterprise']);
    expect(options[0]?.limitDeltas.seats).toBe(PLAN_LIMITS.starter.seats - PLAN_LIMITS.free.seats);
    expect(options[0]?.resolves).toEqual(['seats', 'storage_mb']);
  });

  it('a plan that is still too small does not claim to resolve the pressure', () => {
    const pressure = [row('seats', 5, 5)];
    const options = buildUpgradeOptions('starter', PLAN_LIMITS.starter, pressure);
    // starter -> pro has 25 seats; 5 used => ok
    expect(options[0]?.plan.key).toBe('pro');
    expect(options[0]?.resolves).toEqual(['seats']);
    const tight = buildUpgradeOptions('free', PLAN_LIMITS.free, [row('seats', 5, 2)]);
    expect(tight[0]?.plan.key).toBe('starter');
    expect(tight[0]?.resolves).toEqual([]); // 5 of 5 seats => exceeded
  });

  it('the top plan has no upgrade options', () => {
    expect(buildUpgradeOptions('enterprise', PLAN_LIMITS.enterprise, [])).toEqual([]);
  });
});
