import { ErrorCode, type LeadStatus } from '@hilatech/contracts';

import {
  bucketStart,
  buildBuckets,
  buildFunnel,
  csvCell,
  fillSeries,
  rate,
  resolveRange,
  toCsv,
} from './analytics-reports.helpers';

const d = (iso: string) => new Date(iso);

describe('bucketStart / buildBuckets', () => {
  it('aligns to UTC midnight, Monday and the first of the month', () => {
    expect(bucketStart(d('2026-11-09T15:30:00Z'), 'day').toISOString()).toBe('2026-11-09T00:00:00.000Z');
    // 2026-11-09 is a Monday; Sunday 2026-11-08 belongs to the week of Monday 2026-11-02
    expect(bucketStart(d('2026-11-09T15:30:00Z'), 'week').toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(bucketStart(d('2026-11-08T23:59:59Z'), 'week').toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(bucketStart(d('2026-11-30T23:59:59Z'), 'month').toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('covers [from, to) with one bucket per period, including partial first/last ones', () => {
    const days = buildBuckets(d('2026-11-01T10:00:00Z'), d('2026-11-04T00:00:00Z'), 'day');
    expect(days.map((b) => b.toISOString().slice(0, 10))).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    const weeks = buildBuckets(d('2026-11-04T00:00:00Z'), d('2026-11-17T00:00:00Z'), 'week');
    expect(weeks.map((b) => b.toISOString().slice(0, 10))).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    const months = buildBuckets(d('2026-10-15T00:00:00Z'), d('2027-01-02T00:00:00Z'), 'month');
    expect(months.map((b) => b.toISOString().slice(0, 7))).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
  });
});

describe('resolveRange', () => {
  const now = d('2026-11-09T12:00:00Z');
  it('defaults to the last 30 days ending now, daily', () => {
    const r = resolveRange({ granularity: 'day' }, now);
    expect(r.to).toEqual(now);
    expect(r.from.toISOString()).toBe('2026-10-10T12:00:00.000Z');
    expect(r.buckets).toHaveLength(31);
  });
  it('rejects inverted and over-long ranges with a validation error', () => {
    expect(() => resolveRange({ granularity: 'day', from: '2026-11-09T00:00:00Z', to: '2026-11-01T00:00:00Z' }, now))
      .toThrow(expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }));
    expect(() => resolveRange({ granularity: 'day', from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }, now))
      .toThrow(expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }));
  });
});

describe('fillSeries', () => {
  it('zero-fills missing buckets and keeps order', () => {
    const buckets = buildBuckets(d('2026-11-01T00:00:00Z'), d('2026-11-04T00:00:00Z'), 'day');
    const series = fillSeries<{ bucket: Date; n: number }, { bucket: string; count: number }>(
      buckets,
      [{ bucket: d('2026-11-02T00:00:00Z'), n: 5 }],
      (row) => ({ count: row?.n ?? 0 }),
    );
    expect(series.map((p) => p.count)).toEqual([0, 5, 0]);
    expect(series[1]?.bucket).toBe('2026-11-02T00:00:00.000Z');
  });
});

describe('buildFunnel', () => {
  const counts = (over: Partial<Record<LeadStatus, number>>): Record<LeadStatus, number> => ({
    new: 0, contacted: 0, qualified: 0, proposal: 0, won: 0, lost: 0, ...over,
  });
  it('counts "reached" as current status at or beyond the stage; top stage = all leads', () => {
    const f = buildFunnel(counts({ new: 4, contacted: 3, qualified: 2, proposal: 1, won: 2, lost: 3 }));
    expect(f.stages.map((s) => [s.status, s.reached])).toEqual([
      ['new', 15], ['contacted', 8], ['qualified', 5], ['proposal', 3], ['won', 2],
    ]);
    expect(f.stages[1]?.rateFromPrevious).toBeCloseTo(8 / 15, 3);
    expect(f.stages[4]?.rateFromTop).toBeCloseTo(2 / 15, 3);
    expect(f.lost).toBe(3);
    expect(f.conversionRate).toBeCloseTo(2 / 15, 3);
  });
  it('is all null rates for an empty range', () => {
    const f = buildFunnel(counts({}));
    expect(f.conversionRate).toBeNull();
    expect(f.stages.every((s) => s.reached === 0 && s.rateFromTop === null)).toBe(true);
  });
});

describe('rate', () => {
  it('rounds to 4 decimals and is null for an empty denominator', () => {
    expect(rate(1, 3)).toBe(0.3333);
    expect(rate(0, 0)).toBeNull();
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });
  it('neutralises spreadsheet formulas in text cells but leaves real negative numbers alone', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe('-5');
  });
  it('joins rows with CRLF and ends with a newline', () => {
    expect(toCsv(['a', 'b'], [[1, 'x'], [2, null]])).toBe('a,b\r\n1,x\r\n2,\r\n');
  });
});
