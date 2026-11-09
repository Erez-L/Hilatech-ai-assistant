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

export default function ForgotPasswordPage() {
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
        title="Check your inbox"
        description={`If an account exists for ${sent}, a reset link is on its way. It expires in about an hour.`}
        footer={
          <Link href="/login" className="font-medium text-accent hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-fg-muted">
          Didn’t get it? Check your spam folder, or{' '}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => setSent(null)}
          >
            send it again
          </button>
          .
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you use to sign in and we’ll send you a link."
      footer={
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <FormField id="email" label="Email" error={form.formState.errors.email?.message} required>
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            {...form.register('email')}
          />
        </FormField>
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
