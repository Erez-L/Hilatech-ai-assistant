'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { ErrorCode } from '@hilatech/contracts';
import { Alert, Button, LogoMark } from '@hilatech/ui';
import { authApi, getErrorMessage, isApiError } from '@/lib/api';
import { useSession } from '@/stores/session';
import { useT } from '@/i18n/provider';

/**
 * Shown instead of the app when the API enforces email verification (`REQUIRE_EMAIL_VERIFICATION`)
 * and the signed-in account is not verified yet: resend the email, re-check, or sign out.
 */
export function VerifyEmailGate() {
  const t = useT();
  const user = useSession((s) => s.user);
  const [notice, setNotice] = React.useState<{
    tone: 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);

  const resend = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => setNotice({ tone: 'success', text: t('auth.verificationEmailSent') }),
    onError: (error) =>
      setNotice(
        isApiError(error) && error.code === ErrorCode.RATE_LIMITED
          ? { tone: 'warning', text: t('auth.verificationEmailRecentlySent') }
          : { tone: 'danger', text: getErrorMessage(error) },
      ),
  });

  const recheck = useMutation({
    mutationFn: authApi.me,
    onSuccess: (session) => {
      if (session.user.emailVerifiedAt) {
        const store = useSession.getState();
        store.updateUser({ emailVerifiedAt: session.user.emailVerifiedAt });
        store.setEmailVerificationRequired(false);
      } else {
        setNotice({ tone: 'warning', text: t('auth.emailStillNotVerified') });
      }
    },
    onError: (error) => setNotice({ tone: 'danger', text: getErrorMessage(error) }),
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <main className="flex w-full max-w-md flex-col gap-5 rounded-md border border-border bg-surface p-6 shadow-sm">
        <LogoMark size={32} />
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <MailCheck className="size-5 text-accent" aria-hidden />
            {t('auth.verifyGateTitle')}
          </h1>
          <p className="text-sm text-fg-muted">
            {t('auth.verifyGateBody', { email: user?.email ?? '' })}
          </p>
        </div>
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => recheck.mutate()} loading={recheck.isPending}>
            {t('auth.iHaveVerified')}
          </Button>
          <Button variant="secondary" onClick={() => resend.mutate()} loading={resend.isPending}>
            {t('auth.resendVerificationEmail')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              void authApi.logout().finally(() => useSession.getState().clear());
            }}
          >
            {t('common.signOut')}
          </Button>
        </div>
      </main>
    </div>
  );
}
