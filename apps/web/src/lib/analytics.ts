import { ANALYTICS_MAX_RANGE_DAYS, type AnalyticsGranularity } from '@hilatech/contracts';
import type { AnalyticsRangeParams } from '@/lib/api/analytics';

export type RangePreset = '7d' | '30d' | '90d' | '365d' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string; days?: number }[] = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: '365d', label: '12 months', days: 365 },
  { value: 'custom', label: 'Custom' },
];

export const GRANULARITY_OPTIONS: { value: AnalyticsGranularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
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
): { ok: true; from: string; to: string } | { ok: false; error: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromDate) || !re.test(toDate)) return { ok: false, error: 'Choose both dates' };
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const lastDay = Date.parse(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(lastDay))
    return { ok: false, error: 'Choose valid dates' };
  if (lastDay < from)
    return { ok: false, error: 'The end date must be on or after the start date' };
  const to = lastDay + DAY_MS;
  if ((to - from) / DAY_MS > ANALYTICS_MAX_RANGE_DAYS)
    return { ok: false, error: `Choose a range of at most ${ANALYTICS_MAX_RANGE_DAYS} days` };
  return { ok: true, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export function toRangeParams(
  range: { from: string; to: string },
  granularity: AnalyticsGranularity,
): AnalyticsRangeParams {
  return { from: range.from, to: range.to, granularity };
}

/** Axis / tooltip label for a UTC bucket start. */
export function bucketLabel(iso: string | number, granularity: AnalyticsGranularity): string {
  const d = new Date(typeof iso === 'number' ? iso : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  if (granularity === 'month')
    return d.toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const day = d.toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return granularity === 'week' ? `Week of ${day}` : day;
}

export function formatRangeSummary(range: { from: string; to: string }): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString('en', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const from = Date.parse(range.from);
  const lastDay = Date.parse(range.to) - DAY_MS;
  return `${fmt(from)} – ${fmt(Math.max(from, lastDay))} (UTC)`;
}

/** 0.4286 → "43%"; null → "—". */
export function pct(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 1000) / 10}%`;
}

/** Milliseconds → "850 ms" / "4.2 s" / "2.1 min"; null → "—". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/** USD with enough precision for sub-cent AI spend; null → "—" (never a made-up zero). */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) < 1 ? 4 : 2;
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
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
