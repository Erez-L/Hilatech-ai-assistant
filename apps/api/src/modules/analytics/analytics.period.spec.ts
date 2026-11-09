import {
  countsByKey,
  fillDailySeries,
  isoDate,
  reportingCurrency,
  resolvePeriod,
} from './analytics.period';

describe('analytics period helpers', () => {
  const now = new Date('2026-11-09T15:30:00Z');

  it('resolves N whole UTC days ending today', () => {
    const p7 = resolvePeriod('7d', now);
    expect(p7.days).toBe(7);
    expect(p7.from.toISOString()).toBe('2026-11-03T00:00:00.000Z');
    expect(p7.to).toBe(now);
    expect(resolvePeriod('30d', now).from.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(resolvePeriod('90d', now).from.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('zero-fills the daily series across the whole window and accepts bigint counts', () => {
    const period = resolvePeriod('7d', now);
    const series = fillDailySeries(period, [
      { date: '2026-11-04', count: 2 },
      { date: '2026-11-09', count: BigInt(5) },
    ]);
    expect(series).toHaveLength(7);
    expect(series[0]).toEqual({ date: '2026-11-03', count: 0 });
    expect(series[1]).toEqual({ date: '2026-11-04', count: 2 });
    expect(series[6]).toEqual({ date: '2026-11-09', count: 5 });
    expect(isoDate(now)).toBe('2026-11-09');
  });

  it('fills every enum key in countsByKey', () => {
    expect(countsByKey(['a', 'b', 'c'] as const, [{ key: 'b', count: 3 }])).toEqual({
      a: 0,
      b: 3,
      c: 0,
    });
  });

  it('uses a valid settings currency and falls back to USD otherwise', () => {
    expect(reportingCurrency({ currency: 'EUR' })).toBe('EUR');
    expect(reportingCurrency({ currency: 'eur' })).toBe('USD');
    expect(reportingCurrency({})).toBe('USD');
    expect(reportingCurrency(null)).toBe('USD');
    expect(reportingCurrency('ILS')).toBe('USD');
  });
});
