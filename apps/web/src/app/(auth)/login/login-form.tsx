'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginRequest } from '@hilatech/contracts';
import { Alert, Button, FormField, Input } from '@hilatech/ui';
import { authApi, getErrorMessage, isApiError } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { safeNextPath } from '@/lib/navigation';
import { useSession } from '@/stores/session';
import { AuthCard } from '@/components/auth/auth-card';
import { PasswordInput } from '@/components/auth/password-input';
import { useT } from '@/i18n/provider';

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const [formError, setFormError] = React.useState<string | null>(null);
  const notice = searchParams.get('reset') === '1' ? t('auth.passwordChangedNotice') : null;

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const auth = await authApi.login(values);
      useSession.getState().applyAuthResponse(auth);
      router.replace(auth.organizations.length === 0 ? '/onboarding' : next);
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['email', 'password'])) {
        setFormError(
          isApiError(error) && error.code === 'INVALID_CREDENTIALS'
            ? t('auth.invalidCredentialsHint')
            : getErrorMessage(error),
        );
      }
    }
  });

  return (
    <AuthCard
      title={t('auth.welcomeBack')}
      description={t('auth.signInToYourWorkspace')}
      footer={
        <>
          {t('auth.newToHilatech')}{' '}
          <Link href="/register" className="font-medium text-accent hover:underline">
            {t('auth.createAnAccount')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <FormField
          id="email"
          label={t('common.email')}
          error={form.formState.errors.email?.message}
          required
        >
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            {...form.register('email')}
          />
        </FormField>
        <FormField
          id="password"
          label={t('common.password')}
          error={form.formState.errors.password?.message}
          required
        >
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <div className="-mt-2 flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm text-fg-muted hover:text-fg hover:underline"
          >
            {t('auth.forgotYourPassword')}
          </Link>
        </div>
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
          {t('common.signIn')}
        </Button>
      </form>
    </AuthCard>
  );
}
