import { describe, expect, it } from 'vitest';
import type { BudgetStatus } from '@hilatech/contracts';
import {
  budgetAlertInfo,
  budgetToFormValues,
  describeBudgetExceeded,
  describeLimitDelta,
  entitlementStateNote,
  isBudgetExceededCode,
  parseBudgetForm,
  readBudgetDetails,
} from '../billing';
import {
  bucketLabel,
  customRange,
  formatDuration,
  formatUsd,
  pct,
  presetRange,
  recordToRows,
} from '../analytics';
import { filenameFromDisposition } from '../api/analytics';
import { tEn as t, fmtEn as fmt } from '@/test/i18n';
import { mergeSeries } from '@/app/(app)/analytics/report-parts';

const form = (over: Partial<Parameters<typeof parseBudgetForm>[0]> = {}) => ({
  monthlyTokenBudget: '',
  monthlyCostBudgetUsd: '',
  warnThresholdPct: '80',
  hardStopEnabled: false,
  ...over,
});

describe('parseBudgetForm', () => {
  it('maps empty budgets to null (clears them) and numbers to numbers', () => {
    expect(parseBudgetForm(form(), t)).toEqual({
      ok: true,
      body: {
        monthlyTokenBudget: null,
        monthlyCostBudgetUsd: null,
        warnThresholdPct: 80,
        hardStopEnabled: false,
      },
    });
    expect(
      parseBudgetForm(
        form({ monthlyTokenBudget: '1,500', monthlyCostBudgetUsd: '2.5', hardStopEnabled: true }),
        t,
      ),
    ).toEqual({
      ok: true,
      body: {
        monthlyTokenBudget: 1500,
        monthlyCostBudgetUsd: 2.5,
        warnThresholdPct: 80,
        hardStopEnabled: true,
      },
    });
  });

  it('rejects invalid values like the API contract does', () => {
    const r = parseBudgetForm(
      form({ monthlyTokenBudget: '12.5', monthlyCostBudgetUsd: '-1', warnThresholdPct: '101' }),
      t,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.monthlyTokenBudget).toMatch(/whole number/);
      expect(r.errors.monthlyCostBudgetUsd).toBeTruthy();
      expect(r.errors.warnThresholdPct).toMatch(/1 to 100/);
    }
    const zero = parseBudgetForm(form({ monthlyTokenBudget: '0' }), t);
    expect(zero.ok).toBe(false);
    const warn0 = parseBudgetForm(form({ warnThresholdPct: '0' }), t);
    expect(warn0.ok).toBe(false);
  });

  it('requires a budget before the hard stop can be turned on', () => {
    const r = parseBudgetForm(form({ hardStopEnabled: true }), t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.hardStopEnabled).toMatch(/budget/);
  });

  it('turns a status into form values', () => {
    const status = {
      settings: {
        monthlyTokenBudget: 5000,
        monthlyCostBudgetUsd: null,
        warnThresholdPct: 70,
        hardStopEnabled: true,
      },
    } as BudgetStatus;
    expect(budgetToFormValues(status)).toEqual({
      monthlyTokenBudget: '5000',
      monthlyCostBudgetUsd: '',
      warnThresholdPct: '70',
      hardStopEnabled: true,
    });
  });
});

describe('billing helpers', () => {
  it('describes limit deltas with units and ignores zero or unknown keys', () => {
    expect(describeLimitDelta('seats', 3, t, fmt)).toBe('+3 seats');
    expect(describeLimitDelta('aiTokensPerMonth', 400_000, t, fmt)).toBe('+400K ai tokens / month');
    expect(describeLimitDelta('storageMb', 2048, t, fmt)).toBe('+2 GB storage');
    expect(describeLimitDelta('seats', 0, t, fmt)).toBeNull();
    expect(describeLimitDelta('nope', 4, t, fmt)).toBeNull();
  });

  it('words entitlement states without relying on colour', () => {
    expect(entitlementStateNote({ state: 'ok', enforced: true }, t)).toBeNull();
    expect(entitlementStateNote({ state: 'warning', enforced: true }, t)).toMatch(/Approaching/);
    expect(entitlementStateNote({ state: 'exceeded', enforced: true }, t)).toMatch(/refused/);
    expect(entitlementStateNote({ state: 'exceeded', enforced: false }, t)).toMatch(
      /reported only/,
    );
  });

  it('reads 402 details defensively and describes them', () => {
    expect(isBudgetExceededCode('BUDGET_EXCEEDED')).toBe(true);
    expect(isBudgetExceededCode('AI_NOT_CONFIGURED')).toBe(false);
    expect(readBudgetDetails(null)).toEqual({});
    const d = readBudgetDetails({
      scope: 'budget_tokens',
      reason: 'exhausted',
      used: 1000,
      budget: 1000,
    });
    expect(describeBudgetExceeded(d, t, fmt)).toBe(
      'Your organization’s monthly AI token budget is used up (1,000 of 1,000 used).',
    );
    expect(
      describeBudgetExceeded(
        { scope: 'budget_cost', reason: 'would_exceed', used: 4, budget: 5 },
        t,
        fmt,
      ),
    ).toBe(
      'This request would go over your organization’s monthly AI cost budget ($4 of $5 used).',
    );
    expect(describeBudgetExceeded({}, t, fmt)).toContain('AI token budget is used up');
  });

  it('recognises budget_alert notifications', () => {
    const exceeded = budgetAlertInfo({ data: { kind: 'budget_alert', level: 'exceeded' } });
    expect(exceeded?.level).toBe('exceeded');
    expect(t(exceeded!.label)).toBe('Budget used up');
    const warning = budgetAlertInfo({ data: { kind: 'budget_alert', level: 'warning' } });
    expect(t(warning!.label)).toBe('Budget warning');
    expect(budgetAlertInfo({ data: { kind: 'other' } })).toBeNull();
    expect(budgetAlertInfo({ data: {} })).toBeNull();
  });
});

describe('analytics helpers', () => {
  it('builds stable preset ranges ending at the next UTC midnight', () => {
    const r = presetRange(7, new Date('2026-11-09T15:30:00.000Z'));
    expect(r).toEqual({ from: '2026-11-03T00:00:00.000Z', to: '2026-11-10T00:00:00.000Z' });
  });

  it('turns inclusive custom dates into a [from, to) range and validates', () => {
    expect(customRange('2026-11-01', '2026-11-03', t)).toEqual({
      ok: true,
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-04T00:00:00.000Z',
    });
    expect(customRange('2026-11-05', '2026-11-01', t)).toMatchObject({ ok: false });
    expect(customRange('', '2026-11-01', t)).toMatchObject({ ok: false });
    expect(customRange('2025-01-01', '2026-11-01', t)).toMatchObject({
      ok: false,
      error: expect.stringContaining('366'),
    });
    expect(customRange('2026-01-01', '2026-12-31', t).ok).toBe(true);
  });

  it('formats rates, durations and cost honestly', () => {
    expect(pct(null, fmt)).toBe('—');
    expect(pct(0.4286, fmt)).toBe('42.9%');
    expect(formatDuration(null, fmt)).toBe('—');
    expect(formatDuration(850, fmt)).toBe('850 ms');
    expect(formatDuration(4200, fmt)).toBe('4.2 sec');
    expect(formatDuration(126_000, fmt)).toBe('2.1 min');
    expect(formatUsd(null, fmt)).toBe('—');
    expect(formatUsd(0.0123, fmt)).toBe('$0.0123');
    expect(formatUsd(12.5, fmt)).toBe('$12.50');
  });

  it('labels buckets by granularity in UTC', () => {
    expect(bucketLabel('2026-11-09T00:00:00.000Z', 'day', fmt, t)).toBe('Nov 9');
    expect(bucketLabel('2026-11-09T00:00:00.000Z', 'week', fmt, t)).toBe('Week of Nov 9');
    expect(bucketLabel('2026-11-01T00:00:00.000Z', 'month', fmt, t)).toBe('Nov 2026');
  });

  it('sorts record rows by count and fills missing keys', () => {
    expect(recordToRows({ a: 1, b: 5 })).toEqual([
      { key: 'b', count: 5 },
      { key: 'a', count: 1 },
    ]);
    expect(recordToRows<'a' | 'b'>({ a: 2 }, ['a', 'b'])).toEqual([
      { key: 'a', count: 2 },
      { key: 'b', count: 0 },
    ]);
  });

  it('merges count series by bucket and zero-fills gaps', () => {
    const rows = mergeSeries([
      { key: 'x', points: [{ bucket: '2026-11-01T00:00:00.000Z', count: 2 }] },
      {
        key: 'y',
        points: [
          { bucket: '2026-11-01T00:00:00.000Z', count: 1 },
          { bucket: '2026-11-02T00:00:00.000Z', count: 4 },
        ],
      },
    ]);
    expect(rows).toEqual([
      { bucket: '2026-11-01T00:00:00.000Z', x: 2, y: 1 },
      { bucket: '2026-11-02T00:00:00.000Z', x: 0, y: 4 },
    ]);
  });

  it('reads the export filename from Content-Disposition', () => {
    expect(filenameFromDisposition('attachment; filename="usage-series.csv"', 'x.csv')).toBe(
      'usage-series.csv',
    );
    expect(filenameFromDisposition("attachment; filename*=UTF-8''a%20b.csv", 'x.csv')).toBe(
      'a b.csv',
    );
    expect(filenameFromDisposition(null, 'fallback.csv')).toBe('fallback.csv');
  });
});
