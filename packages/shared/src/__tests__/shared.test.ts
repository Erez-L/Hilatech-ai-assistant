import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, sha256, safeEqual } from '../crypto';
import { slugify, withRandomSuffix } from '../strings';
import { parseDuration, monthPeriod } from '../time';
import { redactSensitive } from '../redaction';

describe('crypto', () => {
  it('generates distinct url-safe tokens', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('hashes deterministically and compares safely', () => {
    expect(sha256('x')).toBe(sha256('x'));
    expect(safeEqual(sha256('x'), sha256('x'))).toBe(true);
    expect(safeEqual(sha256('x'), sha256('y'))).toBe(false);
  });
});

describe('strings', () => {
  it('slugifies', () => {
    expect(slugify('HilaTech Dev!')).toBe('hilatech-dev');
    expect(slugify('   ')).toBe('org');
    expect(withRandomSuffix('acme')).toMatch(/^acme-[a-z0-9]{4}$/);
  });
});

describe('time', () => {
  it('parses durations', () => {
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('7d')).toBe(604_800_000);
    expect(() => parseDuration('soon')).toThrow();
  });
  it('computes month periods in UTC', () => {
    const { start, end } = monthPeriod(new Date('2026-11-09T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('redaction', () => {
  it('redacts sensitive keys recursively', () => {
    const out = redactSensitive({ user: { password: 'p', name: 'n' }, apiKey: 'k', list: [{ token: 't' }] });
    expect(out).toEqual({ user: { password: '[REDACTED]', name: 'n' }, apiKey: '[REDACTED]', list: [{ token: '[REDACTED]' }] });
  });
});
