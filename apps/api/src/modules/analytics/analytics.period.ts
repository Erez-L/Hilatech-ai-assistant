import { type DashboardPeriod } from '@hilatech/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

export const PERIOD_DAYS: Record<DashboardPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };

export interface ResolvedPeriod {
  key: DashboardPeriod;
  /** Inclusive start: UTC midnight of the first day in the window. */
  from: Date;
  /** Inclusive end: the moment the dashboard was requested. */
  to: Date;
  days: number;
}

/** A window of N whole UTC days ending today (so the daily series has exactly N buckets). */
export function resolvePeriod(key: DashboardPeriod, now = new Date()): ResolvedPeriod {
  const days = PERIOD_DAYS[key];
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { key, from: new Date(todayUtc - (days - 1) * DAY_MS), to: now, days };
}

export interface DailyPoint {
  /** ISO date, `YYYY-MM-DD` (UTC). */
  date: string;
  count: number;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Expands sparse `date → count` rows into one point per day of the period, zero-filled. */
export function fillDailySeries(
  period: Pick<ResolvedPeriod, 'from' | 'days'>,
  rows: ReadonlyArray<{ date: string; count: number | bigint }>,
): DailyPoint[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.date, Number(row.count));
  const series: DailyPoint[] = [];
  for (let i = 0; i < period.days; i++) {
    const date = isoDate(new Date(period.from.getTime() + i * DAY_MS));
    series.push({ date, count: counts.get(date) ?? 0 });
  }
  return series;
}

/** `groupBy` rows → a record with every enum value present (zero when absent). */
export function countsByKey<K extends string>(
  keys: readonly K[],
  rows: ReadonlyArray<{ key: K; count: number }>,
): Record<K, number> {
  const result = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const row of rows) result[row.key] = row.count;
  return result;
}

/** Reporting currency: a 3-letter upper-case `currency` in organization settings, else USD. */
export function reportingCurrency(settings: unknown, fallback = 'USD'): string {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const value = (settings as Record<string, unknown>).currency;
    if (typeof value === 'string' && /^[A-Z]{3}$/.test(value)) return value;
  }
  return fallback;
}
