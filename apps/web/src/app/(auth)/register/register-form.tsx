'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterRequest } from '@hilatech/contracts';
import { Alert, Button, FormField, Input, Skeleton } from '@hilatech/ui';
import { authApi, getErrorMessage, isApiError } from '@/lib/api';
import { useInvitationPreview } from '@/hooks/queries';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { safeNextPath } from '@/lib/navigation';
import { useSession } from '@/stores/session';
import { AuthCard } from '@/components/auth/auth-card';
import { PasswordInput } from '@/components/auth/password-input';
import { useT } from '@/i18n/provider';

export function RegisterForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const next = safeNextPath(searchParams.get('next'));
  const [formError, setFormError] = React.useState<string | null>(null);

  const preview = useInvitationPreview(inviteToken);
  const invitationUsable = preview.data?.status === 'pending';

  const form = useForm<RegisterRequest>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      invitationToken: inviteToken ?? undefined,
    },
  });

  // Pre-fill (and lock) the email once the invitation is known.
  const invitedEmail = preview.data?.email;
  React.useEffect(() => {
    if (invitedEmail) form.setValue('email', invitedEmail, { shouldValidate: false });
  }, [invitedEmail, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const auth = await authApi.register({
        ...values,
        invitationToken: invitationUsable && inviteToken ? inviteToken : undefined,
      });
      useSession.getState().applyAuthResponse(auth);
      router.replace(auth.organizations.length === 0 ? '/onboarding' : next);
    } catch (error) {
      if (
        !applyServerErrors(error, form.setError, [
          'email',
          'password',
          'firstName',
          'lastName',
          'invitationToken',
        ])
      ) {
        setFormError(
          isApiError(error) && error.code === 'CONFLICT'
            ? t('auth.accountAlreadyExists')
            : getErrorMessage(error),
        );
      }
    }
  });

  const passwordHint = t('auth.passwordHint');

  return (
    <AuthCard
      title={
        invitationUsable
          ? t('auth.join', { organizationName: preview.data?.organizationName })
          : t('auth.createYourAccount')
      }
      description={
        invitationUsable
          ? t('auth.youVeBeenInvitedAs2', { roleName: preview.data?.roleName })
          : t('auth.startWithYourOwnWorkspace')
      }
      footer={
        <>
          {t('auth.alreadyHaveAnAccount')}{' '}
          <Link
            href={
              inviteToken
                ? `/login?next=${encodeURIComponent(`/invite?token=${inviteToken}`)}`
                : '/login'
            }
            className="font-medium text-accent hover:underline"
          >
            {t('common.signIn')}
          </Link>
        </>
      }
    >
      {inviteToken && preview.isPending ? (
        <div className="mb-5 flex flex-col gap-2" aria-busy>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : null}
      {inviteToken && preview.isError ? (
        <Alert tone="warning" className="mb-5" title={t('auth.thisInvitationLinkIsnT2')}>
          {t('auth.itMayHaveExpiredOr2')}
        </Alert>
      ) : null}
      {inviteToken && preview.data && !invitationUsable ? (
        <Alert
          tone="warning"
          className="mb-5"
          title={t('auth.thisInvitationIs', { status: preview.data.status })}
        >
          {t('auth.askThePersonWhoInvited')}
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="firstName"
            label={t('common.firstName')}
            error={form.formState.errors.firstName?.message}
            required
          >
            <Input autoComplete="given-name" autoFocus {...form.register('firstName')} />
          </FormField>
          <FormField
            id="lastName"
            label={t('common.lastName')}
            error={form.formState.errors.lastName?.message}
            required
          >
            <Input autoComplete="family-name" {...form.register('lastName')} />
          </FormField>
        </div>
        <FormField
          id="email"
          label={t('auth.workEmail')}
          error={form.formState.errors.email?.message}
          description={invitationUsable ? t('auth.theInvitationWasSentTo') : undefined}
          required
        >
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            readOnly={invitationUsable}
            {...form.register('email')}
          />
        </FormField>
        <FormField
          id="password"
          label={t('common.password')}
          description={passwordHint}
          error={form.formState.errors.password?.message}
          required
        >
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
          {invitationUsable ? t('auth.createAccountAndJoin') : t('common.createAccount')}
        </Button>
        <p className="text-center text-xs text-fg-subtle">{t('auth.byContinuingYouAgreeTo')}</p>
      </form>
    </AuthCard>
  );
}
