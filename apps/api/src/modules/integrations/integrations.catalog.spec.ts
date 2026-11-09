import { INTEGRATION_CATALOGUE, isLiveKind, secretProblems } from './integrations.catalog';
import { mergeSecrets } from './integrations.service';

describe('integration catalogue', () => {
  it('marks only rest and n8n as live; everything else is configuration-only', () => {
    expect(INTEGRATION_CATALOGUE.filter((e) => e.liveSupport === 'full').map((e) => e.kind).sort()).toEqual(['n8n', 'rest']);
    for (const kind of ['email', 'whatsapp', 'crm'] as const) expect(isLiveKind(kind)).toBe(false);
  });
});

describe('secretProblems', () => {
  it('requires the credentials the auth type needs', () => {
    expect(secretProblems({ kind: 'rest', baseUrl: 'https://a.test', headers: {}, authType: 'none' }, {})).toEqual([]);
    expect(secretProblems({ kind: 'rest', baseUrl: 'https://a.test', headers: {}, authType: 'bearer' }, {})).toHaveLength(1);
    expect(secretProblems({ kind: 'rest', baseUrl: 'https://a.test', headers: {}, authType: 'bearer' }, { apiKey: 'k' })).toEqual([]);
    expect(secretProblems({ kind: 'rest', baseUrl: 'https://a.test', headers: {}, authType: 'basic' }, { username: 'u' })).toHaveLength(1);
    expect(secretProblems({ kind: 'rest', baseUrl: 'https://a.test', headers: {}, authType: 'header' }, { apiKey: 'k' })).toHaveLength(1);
    expect(
      secretProblems({ kind: 'rest', baseUrl: 'https://a.test', headers: {}, authType: 'header', authHeaderName: 'x-key' }, { apiKey: 'k' }),
    ).toEqual([]);
  });
});

describe('mergeSecrets', () => {
  it('overwrites provided keys, keeps the rest and deletes keys set to an empty string', () => {
    expect(mergeSecrets({ username: 'u', password: 'p' }, { password: 'new', apiKey: 'k' })).toEqual({ username: 'u', password: 'new', apiKey: 'k' });
    expect(mergeSecrets({ username: 'u', password: 'p' }, { password: '' })).toEqual({ username: 'u' });
    expect(mergeSecrets({ username: 'u' }, undefined)).toEqual({ username: 'u' });
  });
});
