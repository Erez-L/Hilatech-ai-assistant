'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Button, Spinner } from '@hilatech/ui';
import { authApi, getErrorMessage } from '@/lib/api';
import { useSession } from '@/stores/session';
import { AuthCard } from '@/components/auth/auth-card';

export function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const mutation = useMutation({
    mutationFn: () => authApi.verifyEmail({ token }),
    onSuccess: () => {
      useSession.getState().updateUser({ emailVerifiedAt: new Date().toISOString() });
    },
  });
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current || !token || token.length < 16) return;
    started.current = true;
    mutation.mutate();
  }, [token, mutation]);

  const signedIn = useSession((s) => s.status === 'authenticated');

  if (!token || token.length < 16) {
    return (
      <AuthCard
        title="This link isn’t complete"
        description="Open the verification link from your email again."
      >
        <Button asChild variant="secondary">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  if (mutation.isSuccess) {
    return (
      <AuthCard title="Email verified" description="Thanks — your address is confirmed.">
        <div className="flex flex-col items-start gap-4">
          <CheckCircle2 className="size-8 text-success" aria-hidden />
          <Button asChild>
            <Link href={signedIn ? '/dashboard' : '/login'}>
              {signedIn ? 'Go to dashboard' : 'Sign in'}
            </Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (mutation.isError) {
    return (
      <AuthCard
        title="We couldn’t verify this link"
        description="It may have expired or already been used."
      >
        <div className="flex flex-col gap-4">
          <Alert tone="danger">{getErrorMessage(mutation.error)}</Alert>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => mutation.mutate()}
              loading={mutation.isPending}
            >
              Try again
            </Button>
            <Button asChild variant="ghost">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </div>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Verifying your email" description="This only takes a moment.">
      <div className="flex items-center gap-3 text-sm text-fg-muted">
        <Spinner size="sm" label="Verifying" />
        Confirming your address…
      </div>
    </AuthCard>
  );
}
