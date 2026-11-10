'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordRequest } from '@hilatech/contracts';
import { Alert, Button, FormField, Input } from '@hilatech/ui';
import { authApi, getErrorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { AuthCard } from '@/components/auth/auth-card';
import { useT } from '@/i18n/provider';

export default function ForgotPasswordPage() {
  const t = useT();
  const [sent, setSent] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await authApi.forgotPassword(values);
      setSent(values.email);
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['email'])) setFormError(getErrorMessage(error));
    }
  });

  if (sent) {
    return (
      <AuthCard
        title={t('auth.checkYourInbox')}
        description={t('auth.ifAnAccountExistsFor', { sent })}
        footer={
          <Link href="/login" className="font-medium text-accent hover:underline">
            {t('auth.backToSignIn')}
          </Link>
        }
      >
        <p className="text-sm text-fg-muted">
          {t('auth.didnTGetItCheck')}{' '}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => setSent(null)}
          >
            {t('auth.sendItAgain')}
          </button>
          .
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('auth.resetYourPassword')}
      description={t('auth.enterTheEmailYouUse')}
      footer={
        <Link href="/login" className="font-medium text-accent hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
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
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
          {t('auth.sendResetLink')}
        </Button>
      </form>
    </AuthCard>
  );
}
