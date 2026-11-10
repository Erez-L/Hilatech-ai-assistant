import { describe, expect, it } from 'vitest';

import { isSafeAppPath, safeNextPath } from '../navigation';

describe('SEC-05: post-login redirect and notification links stay on the origin', () => {
  it('keeps ordinary app paths', () => {
    expect(safeNextPath('/leads?status=new')).toBe('/leads?status=new');
    expect(safeNextPath('/invite?token=abc')).toBe('/invite?token=abc');
    expect(safeNextPath(null)).toBe('/dashboard');
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    '/\\\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'https://evil.example',
    'javascript:alert(1)',
  ])('falls back for %j', (value) => {
    expect(isSafeAppPath(value)).toBe(false);
    expect(safeNextPath(value)).toBe('/dashboard');
  });
});
