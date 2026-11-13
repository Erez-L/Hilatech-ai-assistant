/**
 * Social sign-in providers (OAuth 2.0 authorization-code flow, confidential client).
 *
 * Each provider turns an authorization code into a normalized {@link OAuthProfile}. `emailVerified` is the
 * security-relevant field: only a provider-verified address may be linked to an existing account or skip our own
 * email verification. Where a provider does not state that an address is verified it is treated as unverified.
 */
export const OAUTH_PROVIDERS = ['google', 'microsoft', 'facebook', 'github'] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export interface OAuthProfile {
  provider: OAuthProviderId;
  /** The provider's stable account id. */
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface ProviderDefinition {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Extra query parameters for the authorization request. */
  authorizeParams?: Record<string, string>;
  fetchProfile(accessToken: string, fetchFn: FetchLike): Promise<Omit<OAuthProfile, 'provider'>>;
}

export class OAuthProviderError extends Error {
  constructor(
    message: string,
    readonly step: 'token' | 'profile',
  ) {
    super(message);
    this.name = 'OAuthProviderError';
  }
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const asId = (value: unknown): string | null =>
  typeof value === 'number' ? String(value) : asString(value);

async function getJson(
  url: string,
  accessToken: string,
  fetchFn: FetchLike,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new OAuthProviderError(
      `Profile request failed with status ${response.status}`,
      'profile',
    );
  }
  return response.json();
}

function requireId(id: string | null): string {
  if (!id) throw new OAuthProviderError('The provider returned no account id', 'profile');
  return id;
}

/** Splits a display name into first / last ("Ada Lovelace" → Ada, Lovelace). */
export function splitName(name: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  if (!name) return { firstName: null, lastName: null };
  const parts = name.split(/\s+/).filter(Boolean);
  const [first, ...rest] = parts;
  return { firstName: first ?? null, lastName: rest.length > 0 ? rest.join(' ') : null };
}

const DEFINITIONS: Record<OAuthProviderId, ProviderDefinition> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    authorizeParams: { prompt: 'select_account' },
    async fetchProfile(accessToken, fetchFn) {
      const data = (await getJson(
        'https://openidconnect.googleapis.com/v1/userinfo',
        accessToken,
        fetchFn,
      )) as Record<string, unknown>;
      return {
        providerUserId: requireId(asId(data.sub)),
        email: asString(data.email),
        emailVerified: data.email_verified === true || data.email_verified === 'true',
        firstName: asString(data.given_name),
        lastName: asString(data.family_name),
        avatarUrl: asString(data.picture),
      };
    },
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email profile',
    authorizeParams: { prompt: 'select_account' },
    async fetchProfile(accessToken, fetchFn) {
      const data = (await getJson(
        'https://graph.microsoft.com/oidc/userinfo',
        accessToken,
        fetchFn,
      )) as Record<string, unknown>;
      const fallback = splitName(asString(data.name));
      return {
        providerUserId: requireId(asId(data.sub)),
        email: asString(data.email),
        // Microsoft does not vouch for the `email` claim of every tenant, so it is never trusted as verified.
        emailVerified: false,
        firstName: asString(data.given_name) ?? fallback.firstName,
        lastName: asString(data.family_name) ?? fallback.lastName,
        avatarUrl: null,
      };
    },
  },
  facebook: {
    // Unversioned endpoints: Facebook serves the oldest API version still available to the app.
    authorizeUrl: 'https://www.facebook.com/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/oauth/access_token',
    scope: 'email,public_profile',
    async fetchProfile(accessToken, fetchFn) {
      const data = (await getJson(
        'https://graph.facebook.com/me?fields=id,email,first_name,last_name',
        accessToken,
        fetchFn,
      )) as Record<string, unknown>;
      return {
        providerUserId: requireId(asId(data.id)),
        email: asString(data.email),
        // The Graph API does not say whether the address was confirmed.
        emailVerified: false,
        firstName: asString(data.first_name),
        lastName: asString(data.last_name),
        avatarUrl: null,
      };
    },
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async fetchProfile(accessToken, fetchFn) {
      const headers = { 'User-Agent': 'hilatech-ai-assistant' };
      const user = (await getJson(
        'https://api.github.com/user',
        accessToken,
        fetchFn,
        headers,
      )) as Record<string, unknown>;
      const emails = (await getJson(
        'https://api.github.com/user/emails',
        accessToken,
        fetchFn,
        headers,
      )) as unknown;
      const list = Array.isArray(emails) ? (emails as Record<string, unknown>[]) : [];
      const chosen =
        list.find((e) => e.primary === true && e.verified === true) ??
        list.find((e) => e.verified === true) ??
        list.find((e) => e.primary === true);
      const name = splitName(asString(user.name));
      return {
        providerUserId: requireId(asId(user.id)),
        email: asString(chosen?.email),
        emailVerified: chosen?.verified === true,
        firstName: name.firstName ?? asString(user.login),
        lastName: name.lastName,
        avatarUrl: asString(user.avatar_url),
      };
    },
  },
};

export function buildAuthorizeUrl(
  provider: OAuthProviderId,
  params: { clientId: string; redirectUri: string; state: string },
): string {
  const definition = DEFINITIONS[provider];
  const url = new URL(definition.authorizeUrl);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', definition.scope);
  url.searchParams.set('state', params.state);
  for (const [key, value] of Object.entries(definition.authorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Exchanges the authorization code and loads the account profile. Throws {@link OAuthProviderError}. */
export async function fetchOAuthProfile(
  provider: OAuthProviderId,
  params: OAuthClientCredentials & { code: string; redirectUri: string },
  fetchFn: FetchLike = fetch,
): Promise<OAuthProfile> {
  const definition = DEFINITIONS[provider];
  const response = await fetchFn(definition.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new OAuthProviderError(`Token request failed with status ${response.status}`, 'token');
  }
  const token = (await response.json()) as Record<string, unknown>;
  const accessToken = asString(token.access_token);
  if (!accessToken) throw new OAuthProviderError('The provider returned no access token', 'token');
  const profile = await definition.fetchProfile(accessToken, fetchFn);
  return { provider, ...profile };
}
