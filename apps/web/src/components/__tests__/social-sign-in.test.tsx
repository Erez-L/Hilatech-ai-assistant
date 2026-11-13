import { describe, expect, it } from 'vitest';
import { socialStartUrl } from '../auth/social-sign-in';

describe('socialStartUrl', () => {
  it('points at the API start route for the provider', () => {
    expect(socialStartUrl('google')).toMatch(/\/api\/v1\/auth\/oauth\/google\/start$/);
  });

  it('carries the encoded return path', () => {
    expect(socialStartUrl('github', '/leads?view=mine')).toMatch(
      /\/auth\/oauth\/github\/start\?next=%2Fleads%3Fview%3Dmine$/,
    );
  });
});
