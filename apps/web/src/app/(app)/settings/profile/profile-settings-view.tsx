'use client';

import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, formatDistanceToNow } from 'date-fns';
import { Laptop, LogOut, Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { changePasswordSchema, type AuthUser } from '@hilatech/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  NativeSelect,
  PageHeader,
  Skeleton,
  Switch,
  cn,
  toast,
} from '@hilatech/ui';
import {
  getErrorMessage,
  updateProfileSchema,
  type AuthSessionInfo,
  type UpdateProfileRequest,
} from '@/lib/api';
import {
  useAuthSessions,
  useChangePassword,
  useRevokeSession,
  useUpdatePreferences,
  useUpdateProfile,
} from '@/hooks/queries';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { useSession } from '@/stores/session';
import { usePreferences } from '@/stores/preferences';
import type { Theme } from '@/lib/theme';
import { useThemePreference } from '@/components/shell/theme-toggle';
import { QueryState } from '@/components/common/query-state';
import { SettingsTabs } from '@/components/settings/settings-tabs';
import { NotificationPreferencesCard } from '@/components/settings/notification-preferences-card';
import { PasswordInput } from '@/components/auth/password-input';

export function ProfileSettingsView() {
  const user = useSession((s) => s.user);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Your account, security and preferences.">
        <SettingsTabs />
      </PageHeader>
      {user ? <ProfileForm user={user} /> : null}
      <PreferencesCard />
      <NotificationPreferencesCard />
      <PasswordCard />
      <SessionsCard />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProfileForm({ user }: { user: AuthUser }) {
  const update = useUpdateProfile();
  const [formError, setFormError] = React.useState<string | null>(null);
  const defaults = React.useMemo<UpdateProfileRequest>(
    () => ({ firstName: user.firstName, lastName: user.lastName, avatarUrl: user.avatarUrl ?? '' }),
    [user],
  );
  const form = useForm<UpdateProfileRequest>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: defaults,
  });
  React.useEffect(() => form.reset(defaults), [defaults, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await update.mutateAsync(values);
      toast.success('Profile saved');
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['firstName', 'lastName', 'avatarUrl'])) {
        setFormError(getErrorMessage(error));
      }
    }
  });

  const avatarPreview = useWatch({ control: form.control, name: 'avatarUrl' });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear to teammates.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <div className="flex items-center gap-4">
            <Avatar
              size="xl"
              src={avatarPreview || null}
              firstName={user.firstName}
              lastName={user.lastName}
            />
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{user.email}</span>
              <span className="flex items-center gap-2 text-fg-muted">
                {user.emailVerifiedAt ? (
                  <Badge variant="success" dot>
                    Verified
                  </Badge>
                ) : (
                  <Badge variant="warning" dot>
                    Not verified
                  </Badge>
                )}
                <span>Member since {format(new Date(user.createdAt), 'MMMM yyyy')}</span>
              </span>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="firstName"
              label="First name"
              error={form.formState.errors.firstName?.message}
              required
            >
              <Input autoComplete="given-name" {...form.register('firstName')} />
            </FormField>
            <FormField
              id="lastName"
              label="Last name"
              error={form.formState.errors.lastName?.message}
              required
            >
              <Input autoComplete="family-name" {...form.register('lastName')} />
            </FormField>
          </div>
          <FormField
            id="avatarUrl"
            label="Avatar URL"
            description="Image uploads arrive in a later milestone; paste a link for now."
            error={form.formState.errors.avatarUrl?.message}
          >
            <Input
              type="url"
              inputMode="url"
              placeholder="https://"
              {...form.register('avatarUrl')}
            />
          </FormField>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={!form.formState.isDirty || form.formState.isSubmitting}
            onClick={() => form.reset(defaults)}
          >
            Discard
          </Button>
          <Button
            type="submit"
            loading={form.formState.isSubmitting}
            disabled={!form.formState.isDirty}
          >
            Save profile
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function PreferencesCard() {
  const { theme, setTheme } = useThemePreference();
  const prefs = usePreferences();
  const update = useUpdatePreferences();

  const save = (
    patch: Partial<{ locale: 'en' | 'he'; notifications: { email: boolean; inApp: boolean } }>,
  ) => {
    const next = {
      theme: prefs.theme,
      locale: patch.locale ?? prefs.locale,
      notifications: patch.notifications ?? prefs.notifications,
    };
    prefs.setPreferences(next);
    update.mutate(next, {
      onSuccess: () => toast.success('Preferences saved'),
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

  const themes: { value: Theme; label: string; icon: React.ElementType }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>Appearance, language and how you want to be notified.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Theme</legend>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 sm:max-w-md">
            {themes.map((t) => {
              const Icon = t.icon;
              const active = theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(t.value)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-md border px-3 py-3 text-sm transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    active
                      ? 'border-accent bg-accent-soft text-accent-soft-fg'
                      : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {t.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <FormField
          id="locale"
          label="Language"
          description="Hebrew UI arrives in a later milestone."
          className="sm:max-w-xs"
        >
          <NativeSelect
            value={prefs.locale}
            onChange={(e) => save({ locale: e.target.value as 'en' | 'he' })}
          >
            <option value="en">English</option>
            <option value="he">Hebrew</option>
          </NativeSelect>
        </FormField>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Notifications</legend>
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 sm:max-w-md">
            <span className="flex flex-col">
              <span className="text-sm font-medium">In-app</span>
              <span className="text-xs text-fg-muted">Show notifications in the bell menu.</span>
            </span>
            <Switch
              checked={prefs.notifications.inApp}
              onCheckedChange={(c) => save({ notifications: { ...prefs.notifications, inApp: c } })}
              aria-label="In-app notifications"
            />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 sm:max-w-md">
            <span className="flex flex-col">
              <span className="text-sm font-medium">Email</span>
              <span className="text-xs text-fg-muted">
                Send a summary of important events by email.
              </span>
            </span>
            <Switch
              checked={prefs.notifications.email}
              onCheckedChange={(c) => save({ notifications: { ...prefs.notifications, email: c } })}
              aria-label="Email notifications"
            />
          </label>
        </fieldset>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

const passwordFormSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords don’t match',
    path: ['confirmPassword'],
  });
type PasswordFormValues = z.infer<typeof passwordFormSchema>;

function PasswordCard() {
  const change = useChangePassword();
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    try {
      await change.mutateAsync({ currentPassword, newPassword });
      form.reset();
      toast.success('Password changed');
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['currentPassword', 'newPassword'])) {
        setFormError(getErrorMessage(error));
      }
    }
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Use at least 10 characters with upper and lower case letters and a number.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <FormField
            id="currentPassword"
            label="Current password"
            error={form.formState.errors.currentPassword?.message}
            required
            className="sm:max-w-md"
          >
            <PasswordInput autoComplete="current-password" {...form.register('currentPassword')} />
          </FormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="newPassword"
              label="New password"
              error={form.formState.errors.newPassword?.message}
              required
            >
              <PasswordInput autoComplete="new-password" {...form.register('newPassword')} />
            </FormField>
            <FormField
              id="confirmPassword"
              label="Confirm new password"
              error={form.formState.errors.confirmPassword?.message}
              required
            >
              <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
            </FormField>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" loading={form.formState.isSubmitting}>
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function describeAgent(ua: string | null): { label: string; icon: React.ElementType } {
  if (!ua) return { label: 'Unknown device', icon: Laptop };
  const mobile = /iphone|android|mobile/i.test(ua);
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /chrome\//i.test(ua)
      ? 'Chrome'
      : /safari\//i.test(ua) && !/chrome/i.test(ua)
        ? 'Safari'
        : /firefox\//i.test(ua)
          ? 'Firefox'
          : 'Browser';
  const os = /windows/i.test(ua)
    ? 'Windows'
    : /mac os/i.test(ua)
      ? 'macOS'
      : /iphone|ipad/i.test(ua)
        ? 'iOS'
        : /android/i.test(ua)
          ? 'Android'
          : /linux/i.test(ua)
            ? 'Linux'
            : '';
  return { label: [browser, os].filter(Boolean).join(' on '), icon: mobile ? Smartphone : Laptop };
}

function SessionsCard() {
  const sessions = useAuthSessions();
  const revoke = useRevokeSession();
  const [target, setTarget] = React.useState<AuthSessionInfo | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Devices currently signed in to your account. Sign out any you don’t recognise.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <QueryState
          query={sessions}
          compact
          loading={
            <ul className="divide-y divide-border">
              {Array.from({ length: 2 }).map((_, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-4">
                  <Skeleton className="size-8 rounded-md" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                </li>
              ))}
            </ul>
          }
          isEmpty={(list) => list.length === 0}
          empty={
            <EmptyState
              compact
              title="No active sessions"
              description="This is unexpected — try refreshing the page."
            />
          }
        >
          {(list) => (
            <ul className="divide-y divide-border">
              {[...list]
                .sort((a, b) => Number(b.current) - Number(a.current))
                .map((s) => {
                  const { label, icon: Icon } = describeAgent(s.userAgent);
                  return (
                    <li
                      key={s.familyId}
                      className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted">
                        <Icon className="size-4" aria-hidden />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          {label}
                          {s.current ? (
                            <Badge
                              variant="accent"
                              className="px-1.5 py-0 text-[0.625rem] leading-4"
                            >
                              This device
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-xs text-fg-muted">
                          {s.ipAddress ?? 'Unknown IP'} · Last active{' '}
                          {formatDistanceToNow(new Date(s.lastUsedAt), { addSuffix: true })} ·
                          Signed in {format(new Date(s.createdAt), 'd MMM yyyy')}
                        </span>
                      </div>
                      {s.current ? null : (
                        <Button
                          variant="danger-outline"
                          size="sm"
                          leadingIcon={<LogOut aria-hidden />}
                          onClick={() => setTarget(s)}
                        >
                          Sign out
                        </Button>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </QueryState>
      </CardContent>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Sign out this device?"
        description={
          target
            ? `${describeAgent(target.userAgent).label} will need to sign in again.`
            : undefined
        }
        confirmLabel="Sign out device"
        tone="danger"
        loading={revoke.isPending}
        onConfirm={() => {
          if (!target) return;
          revoke.mutate(target.familyId, {
            onSuccess: () => {
              toast.success('Device signed out');
              setTarget(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          });
        }}
      />
    </Card>
  );
}
