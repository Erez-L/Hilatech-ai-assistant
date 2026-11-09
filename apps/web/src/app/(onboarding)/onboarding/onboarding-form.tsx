'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createOrganizationSchema, type CreateOrganizationRequest } from '@hilatech/contracts';
import { Alert, Button, FormField, Input, NativeSelect, toast } from '@hilatech/ui';
import { authApi, getErrorMessage, organizationsApi } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { useSession } from '@/stores/session';
import { useSignOut } from '@/components/shell/user-menu';
import { COMMON_TIMEZONES, INDUSTRIES } from '@/lib/reference-data';

type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/^-+|-+$/g, '');
}

export function OnboardingForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAdditional = useSearchParams().get('new') === '1';
  const user = useSession((s) => s.user);
  const organizations = useSession((s) => s.organizations);
  const signOut = useSignOut();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [slugTouched, setSlugTouched] = React.useState(false);

  const defaultTz = React.useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const form = useForm<CreateOrganizationInput, unknown, CreateOrganizationRequest>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: '', slug: undefined, industry: undefined, timezone: defaultTz, locale: 'en' },
  });

  const name = useWatch({ control: form.control, name: 'name' });
  React.useEffect(() => {
    if (!slugTouched) form.setValue('slug', name ? slugify(name) : undefined, { shouldValidate: false });
  }, [name, slugTouched, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const org = await organizationsApi.create({
        ...values,
        slug: values.slug || undefined,
        industry: values.industry || undefined,
      });
      // Membership changed: refresh the token payload, then select the new organization.
      const auth = await authApi.refresh();
      if (auth) useSession.getState().applyAuthResponse(auth);
      useSession.getState().setActiveOrganization(org.id);
      queryClient.removeQueries({ queryKey: ['org'] });
      toast.success(`${org.name} is ready`);
      router.replace('/dashboard');
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['name', 'slug', 'industry', 'timezone', 'locale'])) {
        setFormError(getErrorMessage(error));
      }
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isAdditional ? 'Create another organization' : `Welcome${user ? `, ${user.firstName}` : ''}`}
        </h1>
        <p className="text-sm text-fg-muted">
          {isAdditional
            ? 'Each organization has its own team, roles, data and assistant settings.'
            : 'Set up your organization. This is the workspace your team and your assistant will work in.'}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <FormField id="name" label="Organization name" error={form.formState.errors.name?.message} required>
            <Input autoFocus placeholder="Acme Dental Clinic" {...form.register('name')} />
          </FormField>
          <FormField
            id="slug"
            label="Workspace handle"
            description="Lowercase letters, numbers and hyphens. Used in links and integrations."
            error={form.formState.errors.slug?.message}
          >
            <Input
              placeholder="acme-dental"
              {...form.register('slug', { onChange: () => setSlugTouched(true) })}
              onBlur={(e) => {
                if (!e.target.value) setSlugTouched(false);
              }}
            />
          </FormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField id="industry" label="Industry" error={form.formState.errors.industry?.message}>
              <NativeSelect {...form.register('industry')}>
                <option value="">Choose…</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="locale" label="Language" error={form.formState.errors.locale?.message}>
              <NativeSelect {...form.register('locale')}>
                <option value="en">English</option>
                <option value="he">Hebrew</option>
              </NativeSelect>
            </FormField>
          </div>
          <FormField
            id="timezone"
            label="Time zone"
            description="Business hours and reports use this time zone."
            error={form.formState.errors.timezone?.message}
          >
            <NativeSelect {...form.register('timezone')}>
              {!COMMON_TIMEZONES.includes(defaultTz) ? <option value={defaultTz}>{defaultTz}</option> : null}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
            {isAdditional && organizations.length > 0 ? (
              <Button asChild variant="ghost">
                <Link href="/dashboard">Cancel</Link>
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void signOut()}>
                Sign out
              </Button>
            )}
            <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
              Create organization
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
