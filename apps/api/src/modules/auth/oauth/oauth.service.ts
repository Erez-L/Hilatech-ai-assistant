import { API_PREFIX } from '@hilatech/contracts';
import { generateOpaqueToken, safeEqual } from '@hilatech/shared';
import { Injectable, Logger } from '@nestjs/common';

import { type RequestMeta } from '../../../common/request';
import { AppConfig } from '../../../config/app-config.service';
import { AuthService } from '../auth.service';
import { type AuthResult } from '../auth.types';
import { SocialLoginError } from './oauth.errors';
import {
  type FetchLike,
  OAUTH_PROVIDERS,
  type OAuthClientCredentials,
  type OAuthProviderId,
  OAuthProviderError,
  buildAuthorizeUrl,
  fetchOAuthProfile,
} from './oauth.providers';

/** Carried in a short-lived httpOnly cookie between the redirect to the provider and its callback. */
export interface OAuthStatePayload {
  state: string;
  provider: OAuthProviderId;
  /** App-relative path to open after sign-in. */
  next: string | null;
}

export type OAuthFailureCode =
  'not_configured' | 'cancelled' | 'state_mismatch' | 'provider_failed' | SocialLoginError['code'];

export class OAuthFlowError extends Error {
  constructor(readonly code: OAuthFailureCode) {
    super(`OAuth flow failed: ${code}`);
    this.name = 'OAuthFlowError';
  }
}

export const OAUTH_STATE_COOKIE = 'hta_oauth';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Only same-site, app-relative paths ("/leads?x=1"); anything else is dropped (open-redirect guard). */
export function safeAppPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  for (let i = 0; i < value.length; i += 1) if (value.charCodeAt(i) < 0x20) return null;
  return value;
}

export function encodeState(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeState(raw: unknown): OAuthStatePayload | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof parsed.state !== 'string' || typeof parsed.provider !== 'string') return null;
    if (!(OAUTH_PROVIDERS as readonly string[]).includes(parsed.provider)) return null;
    return {
      state: parsed.state,
      provider: parsed.provider as OAuthProviderId,
      next: safeAppPath(parsed.next),
    };
  } catch {
    return null;
  }
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  /** Replaceable in tests. */
  fetchFn: FetchLike = (input, init) => fetch(input, init);

  constructor(
    private readonly config: AppConfig,
    private readonly auth: AuthService,
  ) {}

  credentials(provider: OAuthProviderId): OAuthClientCredentials | null {
    const pairs: Record<OAuthProviderId, [string | undefined, string | undefined]> = {
      google: [
        this.config.get('OAUTH_GOOGLE_CLIENT_ID'),
        this.config.get('OAUTH_GOOGLE_CLIENT_SECRET'),
      ],
      microsoft: [
        this.config.get('OAUTH_MICROSOFT_CLIENT_ID'),
        this.config.get('OAUTH_MICROSOFT_CLIENT_SECRET'),
      ],
      facebook: [
        this.config.get('OAUTH_FACEBOOK_CLIENT_ID'),
        this.config.get('OAUTH_FACEBOOK_CLIENT_SECRET'),
      ],
      github: [
        this.config.get('OAUTH_GITHUB_CLIENT_ID'),
        this.config.get('OAUTH_GITHUB_CLIENT_SECRET'),
      ],
    };
    const [clientId, clientSecret] = pairs[provider];
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  enabledProviders(): OAuthProviderId[] {
    return OAUTH_PROVIDERS.filter((provider) => this.credentials(provider) !== null);
  }

  redirectUri(provider: OAuthProviderId): string {
    const base = this.config.get('API_URL').replace(/\/+$/, '');
    return `${base}${API_PREFIX}/auth/oauth/${provider}/callback`;
  }

  /** URL of the web app to send the browser to (after success or with an error code). */
  appUrl(path: string): string {
    return `${this.config.get('APP_URL').replace(/\/+$/, '')}${path}`;
  }

  start(provider: OAuthProviderId, next: unknown): { url: string; cookie: string } {
    const credentials = this.credentials(provider);
    if (!credentials) throw new OAuthFlowError('not_configured');
    const state = generateOpaqueToken(24);
    return {
      url: buildAuthorizeUrl(provider, {
        clientId: credentials.clientId,
        redirectUri: this.redirectUri(provider),
        state,
      }),
      cookie: encodeState({ state, provider, next: safeAppPath(next) }),
    };
  }

  async callback(
    provider: OAuthProviderId,
    query: { code?: unknown; state?: unknown; error?: unknown },
    stateCookie: unknown,
    meta: RequestMeta,
  ): Promise<{ result: AuthResult; next: string | null }> {
    const credentials = this.credentials(provider);
    if (!credentials) throw new OAuthFlowError('not_configured');

    const expected = decodeState(stateCookie);
    if (
      !expected ||
      expected.provider !== provider ||
      typeof query.state !== 'string' ||
      !safeEqual(expected.state, query.state)
    ) {
      throw new OAuthFlowError('state_mismatch');
    }
    if (typeof query.code !== 'string' || query.code.length === 0) {
      // The provider sends `error=access_denied` (or no code) when the person cancels the consent screen.
      throw new OAuthFlowError('cancelled');
    }

    try {
      const profile = await fetchOAuthProfile(
        provider,
        { ...credentials, code: query.code, redirectUri: this.redirectUri(provider) },
        this.fetchFn,
      );
      return { result: await this.auth.socialLogin(profile, meta), next: expected.next };
    } catch (error) {
      if (error instanceof SocialLoginError) throw new OAuthFlowError(error.code);
      if (error instanceof OAuthProviderError) {
        this.logger.warn({ provider, step: error.step, message: error.message }, 'oauth failed');
        throw new OAuthFlowError('provider_failed');
      }
      throw error;
    }
  }
}
