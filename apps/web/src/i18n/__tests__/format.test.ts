import { describe, expect, it } from 'vitest';
import { createFormatter } from '../format';

const he = createFormatter('he', { timeZone: 'Asia/Jerusalem' });
const en = createFormatter('en', { timeZone: 'Asia/Jerusalem' });

describe('formatter', () => {
  it('honours the currency code instead of assuming USD', () => {
    expect(he.currency(12000, 'ILS')).toContain('₪');
    expect(he.currency(12000, 'ILS')).not.toContain('$');
    expect(en.currency(12000, 'USD')).toBe('$12,000');
    expect(en.currency(12000, 'ILS')).toContain('₪');
    expect(en.currency(12500, 'EUR', { compact: true })).toContain('€');
  });
  it('falls back gracefully for an unknown currency code', () => {
    expect(en.currency(5, 'XXXX')).toContain('XXXX');
  });
  it('formats dates in the Asia/Jerusalem zone', () => {
    // 22:30 UTC on 31 Dec is already 1 Jan in Jerusalem (UTC+2).
    expect(en.date('2025-12-31T22:30:00Z')).toContain('Jan 1, 2026');
    expect(he.date('2025-12-31T22:30:00Z')).toContain('2026');
  });
  it('uses locale digits grouping and percent', () => {
    expect(en.number(1234567)).toBe('1,234,567');
    expect(en.percent(0.256, 1)).toBe('25.6%');
    expect(en.number(Number.NaN)).toBe('—');
  });
  it('formats bytes and durations', () => {
    expect(en.bytes(1536)).toMatch(/1\.5\s?KB/);
    expect(en.duration(1500)).toMatch(/1\.5\s?s/);
  });
  it('drops the ICU "(1)" suffix from Hebrew singular relative times', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(he.relative(now - 60_000, now)).not.toMatch(/\(1\)/);
    expect(he.relative(now - 2 * 3_600_000, now)).toContain('2');
  });
});
