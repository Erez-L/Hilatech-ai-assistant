'use client';

import * as React from 'react';
import { API_PREFIX } from '@hilatech/contracts';
import { Alert } from '@hilatech/ui';
import { api } from '@/lib/api/client';
import { env } from '@/lib/env';
import { useT } from '@/i18n/provider';
import type { MessageKey } from '@/i18n/messages';

export const SOCIAL_PROVIDERS = ['google', 'microsoft', 'facebook', 'github'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

const PROVIDER_NAME: Record<SocialProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  facebook: 'Facebook',
  github: 'GitHub',
};

const ERROR_KEY: Record<string, MessageKey> = {
  cancelled: 'auth.social.errorCancelled',
  account_exists: 'auth.social.errorAccountExists',
  email_missing: 'auth.social.errorEmailMissing',
  inactive: 'auth.social.errorInactive',
  not_configured: 'auth.social.errorNotConfigured',
};

/** Message for the `?oauth_error=` code the API redirects back with (null when there is none). */
export function useSocialError(code: string | null): string | null {
  const t = useT();
  if (!code) return null;
  return t(ERROR_KEY[code] ?? 'auth.social.errorGeneric');
}

/** Full-page navigation target that starts the provider flow on the API. */
export function socialStartUrl(provider: SocialProvider, next?: string | null): string {
  const query = next ? `?next=${encodeURIComponent(next)}` : '';
  return `${env.apiUrl}${API_PREFIX}/auth/oauth/${provider}/start${query}`;
}

/**
 * "Continue with …" buttons for the providers configured on the server. Renders nothing when none is
 * configured (or the list cannot be loaded), so the email + password form keeps working on its own.
 */
export function SocialSignIn({ next, error }: { next?: string | null; error?: string | null }) {
  const t = useT();
  const [providers, setProviders] = React.useState<SocialProvider[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ providers: SocialProvider[] }>('/auth/oauth/providers', {
        auth: false,
        organization: false,
      })
      .then((data) => {
        if (!cancelled) setProviders(data.providers ?? []);
      })
      .catch(() => {
        // Without the list the email + password form is simply shown on its own.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const list = providers.filter((p) => SOCIAL_PROVIDERS.includes(p));

  if (list.length === 0) return error ? <Alert tone="danger">{error}</Alert> : null;

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-col gap-2.5">
        {list.map((provider) => (
          <a
            key={provider}
            href={socialStartUrl(provider, next)}
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg shadow-xs transition hover:border-border-strong hover:bg-surface-muted focus-visible:ring-4 focus-visible:ring-accent/15 focus-visible:outline-none active:scale-[0.99]"
          >
            <span
              aria-hidden
              className="flex size-6 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-fg-muted"
            >
              {PROVIDER_NAME[provider].charAt(0)}
            </span>
            {t('auth.social.continueWith', { provider: PROVIDER_NAME[provider] })}
          </a>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-fg-subtle" role="separator">
        <span className="h-px flex-1 bg-border" />
        {t('auth.social.orWithEmail')}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
