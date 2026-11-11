'use client';
import { vm } from '@/i18n/validation';

import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
  useNotificationPreferences,
  useUpdateNotificationPreferences,
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
import {
  isChannelFullyEnabled,
  setChannelForAll,
  type NotificationChannel,
} from '@/lib/notification-prefs';
import { useT, useFormat, type T } from '@/i18n/provider';
import { useChangeLocale } from '@/components/shell/language-switcher';
import type { Locale } from '@/i18n/config';

export function ProfileSettingsView() {
  const t = useT();
  const user = useSession((s) => s.user);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('settings.settings')}
        description={t('settings.yourAccountSecurityAndPreferences')}
      >
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
  const t = useT();
  const fmt = useFormat();
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
      toast.success(t('settings.profileSaved'));
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
          <CardTitle>{t('settings.profile')}</CardTitle>
          <CardDescription>{t('settings.howYouAppearToTeammates')}</CardDescription>
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
                    {t('settings.verified')}
                  </Badge>
                ) : (
                  <Badge variant="warning" dot>
                    {t('settings.notVerified')}
                  </Badge>
                )}
                <span>
                  {t('settings.memberSince', {
                    monthYear: fmt.monthYear(new Date(user.createdAt)),
                  })}
                </span>
              </span>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="firstName"
              label={t('common.firstName')}
              error={form.formState.errors.firstName?.message}
              required
            >
              <Input autoComplete="given-name" {...form.register('firstName')} />
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
            id="avatarUrl"
            label={t('settings.avatarUrl')}
            description={t('settings.imageUploadsArriveInA')}
            error={form.formState.errors.avatarUrl?.message}
          >
            <Input
              type="url"
              inputMode="url"
              placeholder={t('settings.https')}
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
            {t('common.discard')}
          </Button>
          <Button
            type="submit"
            loading={form.formState.isSubmitting}
            disabled={!form.formState.isDirty}
          >
            {t('settings.saveProfile')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function PreferencesCard() {
  const t = useT();
  const { theme, setTheme } = useThemePreference();
  const prefs = usePreferences();
  const changeLocale = useChangeLocale();

  const notificationPrefs = useNotificationPreferences();
  const updateNotifications = useUpdateNotificationPreferences();

  /** Master switch for a channel: writes the per-type maps the API expects (never plain booleans). */
  const setChannel = (channel: NotificationChannel, enabled: boolean) => {
    updateNotifications.mutate(setChannelForAll(notificationPrefs.data, channel, enabled), {
      onSuccess: () => toast.success(t('settings.preferencesSaved')),
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

  const themes: { value: Theme; label: string; icon: React.ElementType }[] = [
    { value: 'light', label: t('common.light'), icon: Sun },
    { value: 'dark', label: t('common.dark'), icon: Moon },
    { value: 'system', label: t('common.system'), icon: Monitor },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.preferences')}</CardTitle>
        <CardDescription>{t('settings.appearanceLanguageAndHowYou')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t('settings.theme')}</legend>
          <div
            role="radiogroup"
            aria-label={t('settings.theme')}
            className="grid grid-cols-3 gap-2 sm:max-w-md"
          >
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
          label={t('common.language')}
          description={t('settings.hebrewUiArrivesInA')}
          className="sm:max-w-xs"
        >
          <NativeSelect
            value={prefs.locale}
            onChange={(e) => {
              // Uses the merge-PUT (GET + PUT) so server-side notification maps are preserved.
              changeLocale(e.target.value as Locale);
              toast.success(t('settings.preferencesSaved'));
            }}
          >
            <option value="en">{t('common.english')}</option>
            <option value="he">{t('common.hebrew')}</option>
          </NativeSelect>
        </FormField>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">{t('common.notifications')}</legend>
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 sm:max-w-md">
            <span className="flex flex-col">
              <span className="text-sm font-medium">{t('settings.inApp')}</span>
              <span className="text-xs text-fg-muted">
                {t('settings.showNotificationsInTheBell')}
              </span>
            </span>
            <Switch
              checked={isChannelFullyEnabled(notificationPrefs.data, 'inApp')}
              disabled={!notificationPrefs.data || updateNotifications.isPending}
              onCheckedChange={(c) => setChannel('inApp', c)}
              aria-label={t('settings.inAppNotifications')}
            />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 sm:max-w-md">
            <span className="flex flex-col">
              <span className="text-sm font-medium">{t('common.email')}</span>
              <span className="text-xs text-fg-muted">{t('settings.sendASummaryOfImportant')}</span>
            </span>
            <Switch
              checked={isChannelFullyEnabled(notificationPrefs.data, 'email')}
              disabled={!notificationPrefs.data || updateNotifications.isPending}
              onCheckedChange={(c) => setChannel('email', c)}
              aria-label={t('settings.emailNotifications')}
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
    message: vm('common.passwordsDonTMatch'),
    path: ['confirmPassword'],
  });
type PasswordFormValues = z.infer<typeof passwordFormSchema>;

function PasswordCard() {
  const t = useT();
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
      toast.success(t('settings.passwordChanged'));
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
          <CardTitle>{t('common.password')}</CardTitle>
          <CardDescription>{t('settings.useAtLeast10Characters')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <FormField
            id="currentPassword"
            label={t('settings.currentPassword')}
            error={form.formState.errors.currentPassword?.message}
            required
            className="sm:max-w-md"
          >
            <PasswordInput autoComplete="current-password" {...form.register('currentPassword')} />
          </FormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="newPassword"
              label={t('common.newPassword')}
              error={form.formState.errors.newPassword?.message}
              required
            >
              <PasswordInput autoComplete="new-password" {...form.register('newPassword')} />
            </FormField>
            <FormField
              id="confirmPassword"
              label={t('common.confirmNewPassword')}
              error={form.formState.errors.confirmPassword?.message}
              required
            >
              <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
            </FormField>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" loading={form.formState.isSubmitting}>
            {t('common.changePassword')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function describeAgent(ua: string | null, t: T): { label: string; icon: React.ElementType } {
  if (!ua) return { label: t('settings.unknownDevice'), icon: Laptop };
  const mobile = /iphone|android|mobile/i.test(ua);
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /chrome\//i.test(ua)
      ? 'Chrome'
      : /safari\//i.test(ua) && !/chrome/i.test(ua)
        ? 'Safari'
        : /firefox\//i.test(ua)
          ? 'Firefox'
          : t('settings.browserFallback');
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
  return {
    label: os ? t('settings.browserOnOs', { browser, os }) : browser,
    icon: mobile ? Smartphone : Laptop,
  };
}

function SessionsCard() {
  const fmt = useFormat();
  const t = useT();
  const sessions = useAuthSessions();
  const revoke = useRevokeSession();
  const [target, setTarget] = React.useState<AuthSessionInfo | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.activeSessions')}</CardTitle>
        <CardDescription>{t('settings.devicesCurrentlySignedInTo')}</CardDescription>
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
              title={t('settings.noActiveSessions')}
              description={t('settings.thisIsUnexpectedTryRefreshing')}
            />
          }
        >
          {(list) => (
            <ul className="divide-y divide-border">
              {[...list]
                .sort((a, b) => Number(b.current) - Number(a.current))
                .map((s) => {
                  const { label, icon: Icon } = describeAgent(s.userAgent, t);
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
                              {t('settings.thisDevice')}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-xs text-fg-muted">
                          {t('settings.sessionMeta', {
                            ip: s.ipAddress ?? t('settings.unknownIp'),
                            lastActive: fmt.relative(new Date(s.lastUsedAt)),
                            signedIn: fmt.date(new Date(s.createdAt)),
                          })}
                        </span>
                      </div>
                      {s.current ? null : (
                        <Button
                          variant="danger-outline"
                          size="sm"
                          leadingIcon={<LogOut aria-hidden />}
                          onClick={() => setTarget(s)}
                        >
                          {t('common.signOut')}
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
        title={t('settings.signOutThisDevice')}
        description={
          target
            ? t('settings.willNeedToSignIn', { label: describeAgent(target.userAgent, t).label })
            : undefined
        }
        confirmLabel={t('settings.signOutDevice')}
        tone="danger"
        loading={revoke.isPending}
        onConfirm={() => {
          if (!target) return;
          revoke.mutate(target.familyId, {
            onSuccess: () => {
              toast.success(t('settings.deviceSignedOut'));
              setTarget(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          });
        }}
      />
    </Card>
  );
}
