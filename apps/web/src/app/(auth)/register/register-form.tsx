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

export function RegisterForm() {
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
      if (!applyServerErrors(error, form.setError, ['email', 'password', 'firstName', 'lastName', 'invitationToken'])) {
        setFormError(
          isApiError(error) && error.code === 'CONFLICT'
            ? 'An account with this email already exists. Sign in instead.'
            : getErrorMessage(error),
        );
      }
    }
  });

  const passwordHint = 'At least 10 characters with upper and lower case letters and a number.';

  return (
    <AuthCard
      title={invitationUsable ? `Join ${preview.data?.organizationName}` : 'Create your account'}
      description={
        invitationUsable
          ? `You’ve been invited as ${preview.data?.roleName}. Set up your account to accept.`
          : 'Start with your own workspace. You can invite your team afterwards.'
      }
      footer={
        <>
          Already have an account?{' '}
          <Link
            href={inviteToken ? `/login?next=${encodeURIComponent(`/invite?token=${inviteToken}`)}` : '/login'}
            className="font-medium text-accent hover:underline"
          >
            Sign in
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
        <Alert tone="warning" className="mb-5" title="This invitation link isn’t valid">
          It may have expired or been revoked. You can still create an account and ask for a new invitation.
        </Alert>
      ) : null}
      {inviteToken && preview.data && !invitationUsable ? (
        <Alert tone="warning" className="mb-5" title={`This invitation is ${preview.data.status}`}>
          Ask the person who invited you to send a new one.
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="firstName" label="First name" error={form.formState.errors.firstName?.message} required>
            <Input autoComplete="given-name" autoFocus {...form.register('firstName')} />
          </FormField>
          <FormField id="lastName" label="Last name" error={form.formState.errors.lastName?.message} required>
            <Input autoComplete="family-name" {...form.register('lastName')} />
          </FormField>
        </div>
        <FormField
          id="email"
          label="Work email"
          error={form.formState.errors.email?.message}
          description={invitationUsable ? 'The invitation was sent to this address.' : undefined}
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
          label="Password"
          description={passwordHint}
          error={form.formState.errors.password?.message}
          required
        >
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
          {invitationUsable ? 'Create account and join' : 'Create account'}
        </Button>
        <p className="text-center text-xs text-fg-subtle">
          By continuing you agree to use the platform according to your organization’s policies.
        </p>
      </form>
    </AuthCard>
  );
}
