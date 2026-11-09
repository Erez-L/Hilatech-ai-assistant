'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Building2 } from 'lucide-react';
import { Alert, Button, Skeleton, StatusBadge, toast } from '@hilatech/ui';
import { authApi, getErrorMessage } from '@/lib/api';
import { useAcceptInvitation, useInvitationPreview } from '@/hooks/queries';
import { useSession } from '@/stores/session';
import { AuthCard } from '@/components/auth/auth-card';

export function InviteAccept() {
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
      toast.success(`Welcome to ${preview.data?.organizationName ?? 'the team'}`);
      router.replace('/dashboard');
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  if (!token) {
    return (
      <AuthCard title="This invitation link isn’t complete" description="Open the link from your email again.">
        <Button asChild variant="secondary">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  if (preview.isPending) {
    return (
      <AuthCard title="Loading invitation">
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
        title="This invitation isn’t valid"
        description="It may have expired or been revoked. Ask the person who invited you for a new one."
      >
        <Alert tone="warning">{getErrorMessage(preview.error, 'Invitation not found.')}</Alert>
      </AuthCard>
    );
  }

  const inv = preview.data;
  const usable = inv.status === 'pending';
  const emailMismatch = user && user.email.toLowerCase() !== inv.email.toLowerCase();

  return (
    <AuthCard title={`Join ${inv.organizationName}`} description={`You’ve been invited as ${inv.roleName}.`}>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-md border border-border bg-surface-muted/60 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-fg text-fg-inverted">
            <Building2 className="size-5" aria-hidden />
          </div>
          <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-fg-muted">Organization</dt>
            <dd className="font-medium">{inv.organizationName}</dd>
            <dt className="text-fg-muted">Role</dt>
            <dd className="font-medium">{inv.roleName}</dd>
            <dt className="text-fg-muted">Sent to</dt>
            <dd className="font-medium">{inv.email}</dd>
            <dt className="text-fg-muted">Status</dt>
            <dd>
              <StatusBadge status={inv.status} />
            </dd>
            <dt className="text-fg-muted">Expires</dt>
            <dd>{format(new Date(inv.expiresAt), 'PPp')}</dd>
          </dl>
        </div>

        {!usable ? (
          <Alert tone="warning" title={`This invitation is ${inv.status}`}>
            Ask the person who invited you to send a new one.
          </Alert>
        ) : status === 'authenticated' && user ? (
          emailMismatch ? (
            <Alert tone="warning" title="Signed in with a different email">
              You’re signed in as {user.email}, but this invitation was sent to {inv.email}. Sign out and
              continue with the invited address.
            </Alert>
          ) : (
            <Button size="lg" onClick={() => void onAccept()} loading={accept.isPending}>
              Accept and join {inv.organizationName}
            </Button>
          )
        ) : status === 'loading' || status === 'idle' ? (
          <Skeleton className="h-11 w-full" />
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild size="lg" className="flex-1">
              <Link href={`/register?invite=${encodeURIComponent(token)}`}>Create an account</Link>
            </Button>
            <Button asChild size="lg" variant="secondary" className="flex-1">
              <Link href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}>Sign in to accept</Link>
            </Button>
          </div>
        )}
      </div>
    </AuthCard>
  );
}
