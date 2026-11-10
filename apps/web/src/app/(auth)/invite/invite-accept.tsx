'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { Alert, Button, Skeleton, StatusBadge, toast } from '@hilatech/ui';
import { authApi, getErrorMessage } from '@/lib/api';
import { useAcceptInvitation, useInvitationPreview } from '@/hooks/queries';
import { useSession } from '@/stores/session';
import { AuthCard } from '@/components/auth/auth-card';
import { useT, useFormat } from '@/i18n/provider';
import { roleLabel } from '@/i18n/enums';

export function InviteAccept() {
  const fmt = useFormat();
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useSearchParams().get('token') ?? '';
  const preview = useInvitationPreview(token || null);
  const accept = useAcceptInvitation();

  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);

  // Try to restore a session silently so a signed-in user can accept in one click.
  React.useEffect(() => {
    if (status !== 'idle') return;
    useSession.getState().setStatus('loading');
    void authApi.refresh().then((auth) => {
      if (!auth) useSession.getState().clear();
    });
  }, [status]);

  const onAccept = async () => {
    try {
      const member = await accept.mutateAsync(token);
      // Refresh organizations and switch to the one just joined.
      const refreshed = await authApi.refresh();
      if (refreshed) useSession.getState().applyAuthResponse(refreshed);
      useSession.getState().setActiveOrganization(member.organizationId);
      queryClient.removeQueries({ queryKey: ['org'] });
      toast.success(
        t('auth.welcomeToOrg', { org: preview.data?.organizationName ?? t('auth.theTeam') }),
      );
      router.replace('/dashboard');
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  if (!token) {
    return (
      <AuthCard
        title={t('auth.thisInvitationLinkIsnT')}
        description={t('auth.openTheLinkFromYour')}
      >
        <Button asChild variant="secondary">
          <Link href="/login">{t('auth.goToSignIn')}</Link>
        </Button>
      </AuthCard>
    );
  }

  if (preview.isPending) {
    return (
      <AuthCard title={t('auth.loadingInvitation')}>
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-9 w-32" />
        </div>
      </AuthCard>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <AuthCard
        title={t('auth.thisInvitationIsnTValid')}
        description={t('auth.itMayHaveExpiredOr')}
      >
        <Alert tone="warning">{getErrorMessage(preview.error, t('auth.invitationNotFound'))}</Alert>
      </AuthCard>
    );
  }

  const inv = preview.data;
  const usable = inv.status === 'pending';
  const emailMismatch = user && user.email.toLowerCase() !== inv.email.toLowerCase();

  return (
    <AuthCard
      title={t('auth.join', { organizationName: inv.organizationName })}
      description={t('auth.youVeBeenInvitedAs', { roleName: inv.roleName })}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-md border border-border bg-surface-muted/60 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-fg text-fg-inverted">
            <Building2 className="size-5" aria-hidden />
          </div>
          <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-fg-muted">{t('auth.organization')}</dt>
            <dd className="font-medium">{inv.organizationName}</dd>
            <dt className="text-fg-muted">{t('common.role')}</dt>
            <dd className="font-medium">{roleLabel(t, inv.roleName)}</dd>
            <dt className="text-fg-muted">{t('auth.sentTo')}</dt>
            <dd className="font-medium">{inv.email}</dd>
            <dt className="text-fg-muted">{t('common.status')}</dt>
            <dd>
              <StatusBadge status={inv.status} />
            </dd>
            <dt className="text-fg-muted">{t('common.expires')}</dt>
            <dd>{fmt.dateTime(new Date(inv.expiresAt))}</dd>
          </dl>
        </div>

        {!usable ? (
          <Alert tone="warning" title={t('auth.thisInvitationIs', { status: inv.status })}>
            {t('auth.askThePersonWhoInvited')}
          </Alert>
        ) : status === 'authenticated' && user ? (
          emailMismatch ? (
            <Alert tone="warning" title={t('auth.signedInWithADifferent')}>
              {t('auth.youReSignedInAs', { email: user.email, email2: inv.email })}
            </Alert>
          ) : (
            <Button size="lg" onClick={() => void onAccept()} loading={accept.isPending}>
              {t('auth.acceptAndJoin', { organizationName: inv.organizationName })}
            </Button>
          )
        ) : status === 'loading' || status === 'idle' ? (
          <Skeleton className="h-11 w-full" />
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild size="lg" className="flex-1">
              <Link href={`/register?invite=${encodeURIComponent(token)}`}>
                {t('auth.createAnAccount')}
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary" className="flex-1">
              <Link href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}>
                {t('auth.signInToAccept')}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </AuthCard>
  );
}
