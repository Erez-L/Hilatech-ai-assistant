'use client';

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

const formSchema = resetPasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords don’t match',
    path: ['confirmPassword'],
  });
type FormValues = z.infer<typeof formSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async ({ token: t, password }) => {
    setFormError(null);
    try {
      await authApi.resetPassword({ token: t, password });
      router.replace('/login?reset=1');
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['password', 'token'])) {
        setFormError(
          isApiError(error) && (error.isNotFound || error.code === 'TOKEN_INVALID' || error.code === 'TOKEN_EXPIRED')
            ? 'This reset link is no longer valid. Request a new one.'
            : getErrorMessage(error),
        );
      }
    }
  });

  if (!token || token.length < 16) {
    return (
      <AuthCard
        title="This link isn’t complete"
        description="The reset link is missing its token. Open the link from your email again, or request a new one."
        footer={
          <Link href="/forgot-password" className="font-medium text-accent hover:underline">
            Request a new link
          </Link>
        }
      >
        <p className="text-sm text-fg-muted">Reset links expire about an hour after they are sent.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="Use something you don’t use anywhere else.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError ? (
          <Alert tone="danger">
            {formError}{' '}
            <Link href="/forgot-password" className="font-medium underline">
              Request a new link
            </Link>
          </Alert>
        ) : null}
        <input type="hidden" {...form.register('token')} />
        <FormField
          id="password"
          label="New password"
          description="At least 10 characters with upper and lower case letters and a number."
          error={form.formState.errors.password?.message}
          required
        >
          <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
        </FormField>
        <FormField
          id="confirmPassword"
          label="Confirm new password"
          error={form.formState.errors.confirmPassword?.message}
          required
        >
          <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
        </FormField>
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
          Change password
        </Button>
      </form>
    </AuthCard>
  );
}
