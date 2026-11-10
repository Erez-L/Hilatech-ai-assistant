'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { authApi, keys } from '@/lib/api';
import { useSession } from '@/stores/session';
import { FullPageLoader } from '@/components/common/full-page-loader';
import { useT } from '@/i18n/provider';

export interface AuthGateProps {
  children: React.ReactNode;
  /** Redirect to /onboarding when the user belongs to no organization (default true). */
  requireOrganization?: boolean;
}

/**
 * Session bootstrap for authenticated route groups.
 * 1. With no token in memory, try POST /auth/refresh once (httpOnly cookie).
 * 2. Unauthenticated → /login?next=<current path>.
 * 3. Authenticated → GET /auth/me (keyed by the active organization) to resolve permissions.
 * 4. No organizations → /onboarding (unless requireOrganization is false).
 */
export function AuthGate({ children, requireOrganization = true }: AuthGateProps) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = useSession((s) => s.status);
  const accessToken = useSession((s) => s.accessToken);
  const organizations = useSession((s) => s.organizations);
  const orgId = useSession((s) => s.activeOrganizationId);
  const sessionLoaded = useSession((s) => s.sessionLoaded);
  const applySession = useSession((s) => s.applySession);

  // 1. Bootstrap from the refresh cookie.
  React.useEffect(() => {
    if (status !== 'idle') return;
    useSession.getState().setStatus('loading');
    void authApi.refresh().then((auth) => {
      if (!auth) useSession.getState().clear();
      // On success the client's onRefreshed hook already applied the AuthResponse.
    });
  }, [status]);

  // 2. Redirect when the session is gone.
  React.useEffect(() => {
    if (status !== 'unauthenticated') return;
    const qs = searchParams.toString();
    const next = `${pathname}${qs ? `?${qs}` : ''}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [status, router, pathname, searchParams]);

  // 3. Resolve the session (user, organizations, permissions) for the active organization.
  const sessionQuery = useQuery({
    queryKey: keys.session(orgId),
    queryFn: authApi.me,
    enabled: status === 'authenticated' && !!accessToken,
    staleTime: 5 * 60 * 1000,
  });

  const requestedOrgId = orgId;
  React.useEffect(() => {
    if (sessionQuery.data) applySession(sessionQuery.data, requestedOrgId);
  }, [sessionQuery.data, applySession, requestedOrgId]);

  // 4. No organization yet → onboarding.
  const needsOnboarding =
    requireOrganization &&
    status === 'authenticated' &&
    sessionLoaded &&
    organizations.length === 0;
  React.useEffect(() => {
    if (needsOnboarding) router.replace('/onboarding');
  }, [needsOnboarding, router]);

  if (status === 'idle' || status === 'loading') return <FullPageLoader />;
  if (status === 'unauthenticated') return <FullPageLoader label={t('auth.redirectingToSignIn')} />;
  if (!sessionLoaded) {
    if (sessionQuery.isError) {
      // Session could not be resolved (e.g. API down). Let the user retry rather than spin forever.
      return (
        <SessionError
          onRetry={() => void sessionQuery.refetch()}
          onSignOut={() => useSession.getState().clear()}
        />
      );
    }
    return <FullPageLoader />;
  }
  if (needsOnboarding) return <FullPageLoader label={t('auth.settingUpYourWorkspace')} />;
  return <>{children}</>;
}

function SessionError({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  const t = useT();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <div className="flex max-w-sm flex-col gap-3 text-center">
        <h1 className="text-lg font-semibold">{t('auth.weCouldnTLoadYour')}</h1>
        <p className="text-sm text-fg-muted">{t('auth.theServerDidnTRespond')}</p>
        <div className="mt-2 flex justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="h-9 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            {t('common.tryAgain')}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="h-9 rounded-sm border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
          >
            {t('common.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
