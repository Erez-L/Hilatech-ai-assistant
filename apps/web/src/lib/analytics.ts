import { ANALYTICS_MAX_RANGE_DAYS, type AnalyticsGranularity } from '@hilatech/contracts';
import type { AnalyticsRangeParams } from '@/lib/api/analytics';
import { msg, type Msg } from '@/i18n/msg';
import type { Formatter } from '@/i18n/format';
import type { T } from '@/i18n/provider';

export type RangePreset = '7d' | '30d' | '90d' | '365d' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: Msg; days?: number }[] = [
  { value: '7d', label: msg('analytics.range.7d'), days: 7 },
  { value: '30d', label: msg('analytics.range.30d'), days: 30 },
  { value: '90d', label: msg('analytics.range.90d'), days: 90 },
  { value: '365d', label: msg('analytics.range.365d'), days: 365 },
  { value: 'custom', label: msg('analytics.range.custom') },
];

export const GRANULARITY_OPTIONS: { value: AnalyticsGranularity; label: Msg }[] = [
  { value: 'day', label: msg('analytics.granularity.day') },
  { value: 'week', label: msg('analytics.granularity.week') },
  { value: 'month', label: msg('analytics.granularity.month') },
];

const DAY_MS = 86_400_000;

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Range for a preset: the last N whole UTC days, ending at the next UTC midnight (exclusive) so that
 * today is included and the query key stays stable for the whole day.
 */
export function presetRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = startOfUtcDay(now) + DAY_MS;
  return { from: new Date(to - days * DAY_MS).toISOString(), to: new Date(to).toISOString() };
}

/** Converts inclusive `yyyy-mm-dd` dates into the API's [from, to) ISO range, or an error message. */
export function customRange(
  fromDate: string,
  toDate: string,
  t: T,
): { ok: true; from: string; to: string } | { ok: false; error: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromDate) || !re.test(toDate))
    return { ok: false, error: t('analytics.chooseBothDates') };
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const lastDay = Date.parse(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(lastDay))
    return { ok: false, error: t('analytics.chooseValidDates') };
  if (lastDay < from) return { ok: false, error: t('analytics.endBeforeStart') };
  const to = lastDay + DAY_MS;
  if ((to - from) / DAY_MS > ANALYTICS_MAX_RANGE_DAYS)
    return {
      ok: false,
      error: t('analytics.rangeTooLong', { days: ANALYTICS_MAX_RANGE_DAYS }),
    };
  return { ok: true, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export function toRangeParams(
  range: { from: string; to: string },
  granularity: AnalyticsGranularity,
): AnalyticsRangeParams {
  return { from: range.from, to: range.to, granularity };
}

/** Axis / tooltip label for a UTC bucket start. */
export function bucketLabel(
  iso: string | number,
  granularity: AnalyticsGranularity,
  fmt: Formatter,
  t: T,
): string {
  const d = new Date(typeof iso === 'number' ? iso : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  if (granularity === 'month') return fmt.utcMonthYear(d);
  const day = fmt.utcDayMonth(d);
  return granularity === 'week' ? t('analytics.weekOf', { day }) : day;
}

export function formatRangeSummary(range: { from: string; to: string }, fmt: Formatter): string {
  const from = Date.parse(range.from);
  const lastDay = Date.parse(range.to) - DAY_MS;
  return `${fmt.utcDate(from)} – ${fmt.utcDate(Math.max(from, lastDay))} (UTC)`;
}

/** 0.4286 -> "42.9%"; null -> an em dash. */
export function pct(ratio: number | null | undefined, fmt: Formatter): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return fmt.percent(ratio, 1);
}

/** Milliseconds -> "850 ms" / "4.2 sec" / "2.1 min"; null -> an em dash. */
export function formatDuration(ms: number | null | undefined, fmt: Formatter): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return fmt.duration(ms);
}

/** USD with enough precision for sub-cent AI spend; null -> an em dash (never a made-up zero). */
export function formatUsd(value: number | null | undefined, fmt: Formatter): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return fmt.preciseCurrency(value, 'USD');
}

/** Record → sorted rows (largest first), dropping nothing so zero counts stay visible when asked. */
export function recordToRows<K extends string>(
  record: Partial<Record<K, number>>,
  keys?: readonly K[],
): { key: K; count: number }[] {
  const entries = (keys ?? (Object.keys(record) as K[])).map((key) => ({
    key,
    count: record[key] ?? 0,
  }));
  return entries.sort((a, b) => b.count - a.count);
}

/** True when a series has any non-zero point for the given keys. */
export function hasActivity<T extends object>(series: T[], keys: (keyof T)[]): boolean {
  return series.some((p) => keys.some((k) => Number(p[k]) > 0));
}

/** Triggers a browser download of a Blob (object URL is revoked immediately after the click). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
