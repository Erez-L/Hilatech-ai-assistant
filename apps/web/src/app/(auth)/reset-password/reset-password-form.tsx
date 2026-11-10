'use client';
import { vm } from '@/i18n/validation';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { resetPasswordSchema } from '@hilatech/contracts';
import { Alert, Button, FormField } from '@hilatech/ui';
import { authApi, getErrorMessage, isApiError } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { AuthCard } from '@/components/auth/auth-card';
import { PasswordInput } from '@/components/auth/password-input';
import { useT } from '@/i18n/provider';

const formSchema = resetPasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: vm('common.passwordsDonTMatch'),
    path: ['confirmPassword'],
  });
type FormValues = z.infer<typeof formSchema>;

export function ResetPasswordForm() {
  const t = useT();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async ({ token: resetToken, password }) => {
    setFormError(null);
    try {
      await authApi.resetPassword({ token: resetToken, password });
      router.replace('/login?reset=1');
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['password', 'token'])) {
        setFormError(
          isApiError(error) &&
            (error.isNotFound || error.code === 'TOKEN_INVALID' || error.code === 'TOKEN_EXPIRED')
            ? t('auth.resetLinkInvalid')
            : getErrorMessage(error),
        );
      }
    }
  });

  if (!token || token.length < 16) {
    return (
      <AuthCard
        title={t('auth.thisLinkIsnTComplete')}
        description={t('auth.theResetLinkIsMissing')}
        footer={
          <Link href="/forgot-password" className="font-medium text-accent hover:underline">
            {t('auth.requestANewLink')}
          </Link>
        }
      >
        <p className="text-sm text-fg-muted">{t('auth.resetLinksExpireAboutAn')}</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.chooseANewPassword')} description={t('auth.useSomethingYouDonT')}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError ? (
          <Alert tone="danger">
            {formError}{' '}
            <Link href="/forgot-password" className="font-medium underline">
              {t('auth.requestANewLink')}
            </Link>
          </Alert>
        ) : null}
        <input type="hidden" {...form.register('token')} />
        <FormField
          id="password"
          label={t('common.newPassword')}
          description={t('auth.atLeast10CharactersWith')}
          error={form.formState.errors.password?.message}
          required
        >
          <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
        </FormField>
        <FormField
          id="confirmPassword"
          label={t('common.confirmNewPassword')}
          error={form.formState.errors.confirmPassword?.message}
          required
        >
          <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
        </FormField>
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
          {t('common.changePassword')}
        </Button>
      </form>
    </AuthCard>
  );
}
