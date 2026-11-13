import {
  type FetchLike,
  OAuthProviderError,
  buildAuthorizeUrl,
  fetchOAuthProfile,
  splitName,
} from './oauth.providers';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function routes(table: Record<string, unknown>): { fetchFn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchFn: async (url) => {
      calls.push(url);
      const key = Object.keys(table).find((k) => url.startsWith(k));
      return key ? json(table[key]) : json({}, 404);
    },
  };
}

const params = { clientId: 'id', clientSecret: 'secret', code: 'c', redirectUri: 'https://x/cb' };

describe('OAuth providers', () => {
  it('builds an authorization URL with scope and state', () => {
    const url = new URL(
      buildAuthorizeUrl('github', { clientId: 'id', redirectUri: 'https://x/cb', state: 's1' }),
    );
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('GitHub: picks the primary verified email and splits the display name', async () => {
    const { fetchFn } = routes({
      'https://github.com/login/oauth/access_token': { access_token: 't' },
      'https://api.github.com/user/emails': [
        { email: 'old@example.com', primary: false, verified: true },
        { email: 'me@example.com', primary: true, verified: true },
      ],
      'https://api.github.com/user': { id: 42, login: 'ada', name: 'Ada King Lovelace' },
    });
    const profile = await fetchOAuthProfile('github', params, fetchFn);
    expect(profile).toMatchObject({
      provider: 'github',
      providerUserId: '42',
      email: 'me@example.com',
      emailVerified: true,
      firstName: 'Ada',
      lastName: 'King Lovelace',
    });
  });

  it('GitHub: an unverified primary email is reported as unverified', async () => {
    const { fetchFn } = routes({
      'https://github.com/login/oauth/access_token': { access_token: 't' },
      'https://api.github.com/user/emails': [
        { email: 'me@example.com', primary: true, verified: false },
      ],
      'https://api.github.com/user': { id: 7, login: 'ada', name: null },
    });
    const profile = await fetchOAuthProfile('github', params, fetchFn);
    expect(profile.emailVerified).toBe(false);
    expect(profile.firstName).toBe('ada');
  });

  it('Microsoft and Facebook emails are never treated as verified', async () => {
    const ms = routes({
      'https://login.microsoftonline.com/common/oauth2/v2.0/token': { access_token: 't' },
      'https://graph.microsoft.com/oidc/userinfo': {
        sub: 'ms-1',
        email: 'a@contoso.com',
        name: 'A B',
      },
    });
    expect(await fetchOAuthProfile('microsoft', params, ms.fetchFn)).toMatchObject({
      providerUserId: 'ms-1',
      emailVerified: false,
      firstName: 'A',
      lastName: 'B',
    });
    const fb = routes({
      'https://graph.facebook.com/oauth/access_token': { access_token: 't' },
      'https://graph.facebook.com/me': { id: '99', email: 'f@example.com', first_name: 'F' },
    });
    expect(await fetchOAuthProfile('facebook', params, fb.fetchFn)).toMatchObject({
      providerUserId: '99',
      emailVerified: false,
    });
  });

  it('Google: email_verified false stays false', async () => {
    const { fetchFn } = routes({
      'https://oauth2.googleapis.com/token': { access_token: 't' },
      'https://openidconnect.googleapis.com/v1/userinfo': {
        sub: 'g',
        email: 'g@x.com',
        email_verified: false,
      },
    });
    expect((await fetchOAuthProfile('google', params, fetchFn)).emailVerified).toBe(false);
  });

  it('fails clearly when the token or the account id is missing', async () => {
    const noToken = routes({ 'https://oauth2.googleapis.com/token': {} });
    await expect(fetchOAuthProfile('google', params, noToken.fetchFn)).rejects.toBeInstanceOf(
      OAuthProviderError,
    );
    const noId = routes({
      'https://oauth2.googleapis.com/token': { access_token: 't' },
      'https://openidconnect.googleapis.com/v1/userinfo': { email: 'g@x.com' },
    });
    await expect(fetchOAuthProfile('google', params, noId.fetchFn)).rejects.toThrow(/account id/);
  });

  it('splitName handles empty and single-word names', () => {
    expect(splitName(null)).toEqual({ firstName: null, lastName: null });
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: null });
  });
});
