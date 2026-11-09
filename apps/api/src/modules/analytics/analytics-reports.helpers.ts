import {
  ANALYTICS_DEFAULT_RANGE_DAYS,
  ANALYTICS_MAX_RANGE_DAYS,
  type AnalyticsGranularity,
  type AnalyticsRangeQuery,
  LeadStatus,
} from '@hilatech/contracts';

import { AppException } from '../../common/errors/app.exception';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResolvedRange {
  from: Date;
  /** Exclusive. */
  to: Date;
  granularity: AnalyticsGranularity;
  /** Bucket starts (UTC) covering [from, to): every series is zero-filled to exactly these. */
  buckets: Date[];
}

/** UTC start of the bucket containing `date` (Postgres `date_trunc` semantics: weeks start on Monday). */
export function bucketStart(date: Date, granularity: AnalyticsGranularity): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  if (granularity === 'month') return new Date(Date.UTC(y, m, 1));
  const midnight = Date.UTC(y, m, d);
  if (granularity === 'day') return new Date(midnight);
  const mondayOffset = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(midnight - mondayOffset * DAY_MS);
}

function nextBucket(start: Date, granularity: AnalyticsGranularity): Date {
  if (granularity === 'month') {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
  return new Date(start.getTime() + (granularity === 'week' ? 7 : 1) * DAY_MS);
}

export function buildBuckets(from: Date, to: Date, granularity: AnalyticsGranularity): Date[] {
  const buckets: Date[] = [];
  let cursor = bucketStart(from, granularity);
  while (cursor.getTime() < to.getTime()) {
    buckets.push(cursor);
    cursor = nextBucket(cursor, granularity);
  }
  return buckets;
}

/** Validates `from`/`to`/`granularity`; defaults to the last 30 days ending now. */
export function resolveRange(query: AnalyticsRangeQuery, now = new Date()): ResolvedRange {
  const to = query.to ? new Date(query.to) : now;
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - ANALYTICS_DEFAULT_RANGE_DAYS * DAY_MS);
  if (from.getTime() >= to.getTime()) {
    throw AppException.validation('`to` must be after `from`', [
      { path: 'to', message: 'Range end must be after its start', code: 'custom' },
    ]);
  }
  if (to.getTime() - from.getTime() > ANALYTICS_MAX_RANGE_DAYS * DAY_MS) {
    throw AppException.validation(`The range may not exceed ${ANALYTICS_MAX_RANGE_DAYS} days`, [
      {
        path: 'from',
        message: `Range longer than ${ANALYTICS_MAX_RANGE_DAYS} days`,
        code: 'custom',
      },
    ]);
  }
  return {
    from,
    to,
    granularity: query.granularity,
    buckets: buildBuckets(from, to, query.granularity),
  };
}

/** Zero-filled series: one entry per bucket, `empty` where the database had no row. */
export function fillSeries<Row extends { bucket: Date }, Out extends { bucket: string }>(
  buckets: readonly Date[],
  rows: readonly Row[],
  map: (row: Row | undefined, bucketIso: string) => Omit<Out, 'bucket'>,
): Out[] {
  const byBucket = new Map<string, Row>();
  for (const row of rows) byBucket.set(row.bucket.toISOString(), row);
  return buckets.map((b) => {
    const iso = b.toISOString();
    return { bucket: iso, ...map(byBucket.get(iso), iso) } as Out;
  });
}

export const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));
export const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

export function roundMs(value: unknown): number | null {
  const n = numOrNull(value);
  return n === null ? null : Math.round(n);
}

// ----- funnel ----------------------------------------------------------------------------------

export const FUNNEL_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won'] as const;

export interface FunnelStage {
  status: LeadStatus;
  reached: number;
  rateFromPrevious: number | null;
  rateFromTop: number | null;
}

/**
 * Funnel from the CURRENT status of the leads in the range (there is no stage-history table):
 * a lead "reached" a stage when its status is that stage or a later one. Every lead starts at `new`,
 * so the top stage is all leads including lost ones; `lost` leads are not attributed to later stages.
 */
export function buildFunnel(byStatus: Record<LeadStatus, number>): {
  stages: FunnelStage[];
  lost: number;
  conversionRate: number | null;
} {
  const total = LeadStatus.options.reduce((sum, s) => sum + byStatus[s], 0);
  const stages: FunnelStage[] = [];
  let previous: number | null = null;
  FUNNEL_STAGES.forEach((status, index) => {
    const reached =
      index === 0
        ? total
        : FUNNEL_STAGES.slice(index).reduce((sum, s) => sum + byStatus[s], 0);
    stages.push({
      status,
      reached,
      rateFromPrevious: previous === null ? null : rate(reached, previous),
      rateFromTop: total === 0 ? null : rate(reached, total),
    });
    previous = reached;
  });
  return { stages, lost: byStatus.lost, conversionRate: rate(byStatus.won, total) };
}

// ----- CSV -------------------------------------------------------------------------------------

/**
 * RFC 4180 CSV. Cells that start with `= + - @` (or tab/CR) are prefixed with an apostrophe so a
 * spreadsheet never evaluates exported text as a formula (CSV injection). Numbers pass through.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? String(value) : value;
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}
