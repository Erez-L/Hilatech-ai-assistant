'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Permission,
  organizationSettingsSchema,
  updateOrganizationSchema,
  type Organization,
  type OrganizationSettings,
  type UpdateOrganizationRequest,
} from '@hilatech/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  FormField,
  Input,
  NativeSelect,
  PageHeader,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@hilatech/ui';
import { authApi, getErrorMessage } from '@/lib/api';
import {
  useDeleteOrganization,
  useLeaveOrganization,
  useOrganization,
  useOrganizationSettings,
  useUpdateOrganization,
  useUpdateOrganizationSettings,
} from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { COMMON_TIMEZONES, DAYS, INDUSTRIES, type DayKey } from '@/lib/reference-data';
import { QueryState } from '@/components/common/query-state';
import { PermissionGate } from '@/components/common/permission-gate';
import { SettingsTabs } from '@/components/settings/settings-tabs';

export function OrganizationSettingsView() {
  const organization = useOrganization();
  const settings = useOrganizationSettings();
  const canUpdate = useCan(Permission.ORG_UPDATE);

  return (
    <PermissionGate anyOf={[Permission.ORG_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Settings"
          description="How this organization presents itself and how its assistant behaves."
        >
          <SettingsTabs />
        </PageHeader>

        <QueryState
          query={organization}
          loading={<FormSkeleton rows={5} />}
          errorTitle="The organization profile couldn’t be loaded"
        >
          {(org) => <ProfileForm organization={org} readOnly={!canUpdate} />}
        </QueryState>

        <QueryState
          query={settings}
          loading={<FormSkeleton rows={6} />}
          errorTitle="Settings couldn’t be loaded"
        >
          {(s) => <AssistantAndHoursForm settings={s} readOnly={!canUpdate} />}
        </QueryState>

        <DangerZone organization={organization.data} />
      </div>
    </PermissionGate>
  );
}

function FormSkeleton({ rows }: { rows: number }) {
  return (
    <Card aria-busy>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileFormSchema = updateOrganizationSchema.extend({
  website: z
    .union([z.string().url('Enter a full URL, e.g. https://example.com'), z.literal('')])
    .optional(),
  logoUrl: z.union([z.string().url('Enter a full URL'), z.literal('')]).optional(),
  description: z.string().trim().max(2000).optional(),
  industry: z.string().trim().max(100).optional(),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

function ProfileForm({
  organization,
  readOnly,
}: {
  organization: Organization;
  readOnly: boolean;
}) {
  const update = useUpdateOrganization();
  const [formError, setFormError] = React.useState<string | null>(null);

  const defaults = React.useMemo<ProfileFormValues>(
    () => ({
      name: organization.name,
      slug: organization.slug,
      industry: organization.industry ?? '',
      timezone: organization.timezone,
      locale: organization.locale,
      website: organization.website ?? '',
      logoUrl: organization.logoUrl ?? '',
      description: organization.description ?? '',
    }),
    [organization],
  );

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: defaults,
  });
  React.useEffect(() => form.reset(defaults), [defaults, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body: UpdateOrganizationRequest = {
      name: values.name,
      slug: values.slug || undefined,
      industry: values.industry || undefined,
      timezone: values.timezone,
      locale: values.locale,
      website: values.website ? values.website : null,
      logoUrl: values.logoUrl ? values.logoUrl : null,
      description: values.description ? values.description : null,
    };
    try {
      const org = await update.mutateAsync(body);
      // Keep the switcher label in sync without a full session reload.
      const session = useSession.getState();
      session.applySession(
        {
          user: session.user!,
          organizations: session.organizations.map((o) =>
            o.id === org.id ? { ...o, name: org.name, slug: org.slug, logoUrl: org.logoUrl } : o,
          ),
          activeOrganization: session.activeOrganization
            ? {
                ...session.activeOrganization,
                name: org.name,
                slug: org.slug,
                logoUrl: org.logoUrl,
              }
            : null,
          permissions: session.permissions,
        },
        session.activeOrganizationId,
      );
      toast.success('Organization profile saved');
    } catch (error) {
      if (
        !applyServerErrors(error, form.setError, [
          'name',
          'slug',
          'industry',
          'timezone',
          'locale',
          'website',
          'logoUrl',
          'description',
        ])
      ) {
        setFormError(getErrorMessage(error));
      }
    }
  });

  const tz = organization.timezone;

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Name, handle and public details of the organization.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          {readOnly ? (
            <Alert tone="neutral">Your role can view these settings but not change them.</Alert>
          ) : null}
          <fieldset disabled={readOnly} className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="org-name"
                label="Name"
                error={form.formState.errors.name?.message}
                required
              >
                <Input {...form.register('name')} />
              </FormField>
              <FormField
                id="org-slug"
                label="Handle"
                description="Lowercase letters, numbers and hyphens."
                error={form.formState.errors.slug?.message}
              >
                <Input className="font-mono" {...form.register('slug')} />
              </FormField>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              <FormField
                id="org-industry"
                label="Industry"
                error={form.formState.errors.industry?.message}
              >
                <NativeSelect {...form.register('industry')}>
                  <option value="">Not set</option>
                  {organization.industry &&
                  !(INDUSTRIES as readonly string[]).includes(organization.industry) ? (
                    <option value={organization.industry}>{organization.industry}</option>
                  ) : null}
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField
                id="org-timezone"
                label="Time zone"
                error={form.formState.errors.timezone?.message}
              >
                <NativeSelect {...form.register('timezone')}>
                  {!COMMON_TIMEZONES.includes(tz) ? <option value={tz}>{tz}</option> : null}
                  {COMMON_TIMEZONES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField
                id="org-locale"
                label="Language"
                error={form.formState.errors.locale?.message}
              >
                <NativeSelect {...form.register('locale')}>
                  <option value="en">English</option>
                  <option value="he">Hebrew</option>
                </NativeSelect>
              </FormField>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="org-website"
                label="Website"
                error={form.formState.errors.website?.message}
              >
                <Input
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  {...form.register('website')}
                />
              </FormField>
              <FormField
                id="org-logo"
                label="Logo URL"
                description="A square image works best."
                error={form.formState.errors.logoUrl?.message}
              >
                <Input
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  {...form.register('logoUrl')}
                />
              </FormField>
            </div>
            <FormField
              id="org-description"
              label="About the business"
              description="The assistant uses this to introduce the business and stay on topic."
              error={form.formState.errors.description?.message}
            >
              <Textarea rows={3} {...form.register('description')} />
            </FormField>
          </fieldset>
        </CardContent>
        {readOnly ? null : (
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
        )}
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Business hours + AI defaults (organizationSettingsSchema)
// ---------------------------------------------------------------------------

const time = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');
const daySchema = z.object({ enabled: z.boolean(), open: time, close: time });
const settingsFormSchema = z
  .object({
    hoursTimezone: z.string().max(64),
    days: z.object({
      sun: daySchema,
      mon: daySchema,
      tue: daySchema,
      wed: daySchema,
      thu: daySchema,
      fri: daySchema,
      sat: daySchema,
    }),
    primaryColor: z.union([
      z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0B7A75'),
      z.literal(''),
    ]),
    aiProvider: z.enum(['', 'anthropic', 'openai']),
    aiModel: z.string().max(100),
    assistantName: z.string().max(60),
    tone: z.enum(['', 'professional', 'friendly', 'concise']),
  })
  .superRefine((v, ctx) => {
    for (const day of DAYS) {
      const d = v.days[day.key];
      if (d.enabled && d.open >= d.close) {
        ctx.addIssue({
          code: 'custom',
          path: ['days', day.key, 'close'],
          message: 'Closing time must be after opening',
        });
      }
    }
  });
type SettingsFormValues = z.infer<typeof settingsFormSchema>;

function toFormValues(s: OrganizationSettings, fallbackTz: string): SettingsFormValues {
  const days = Object.fromEntries(
    DAYS.map((d) => {
      const entry = s.businessHours?.days?.[d.key];
      const weekend = d.key === 'fri' || d.key === 'sat';
      return [
        d.key,
        entry
          ? { enabled: true, open: entry.open, close: entry.close }
          : { enabled: s.businessHours ? false : !weekend, open: '09:00', close: '17:00' },
      ];
    }),
  ) as SettingsFormValues['days'];
  return {
    hoursTimezone: s.businessHours?.timezone ?? fallbackTz,
    days,
    primaryColor: s.branding?.primaryColor ?? '',
    aiProvider: s.ai?.defaultProvider ?? '',
    aiModel: s.ai?.defaultModel ?? '',
    assistantName: s.ai?.assistantName ?? '',
    tone: s.ai?.tone ?? '',
  };
}

function toSettings(v: SettingsFormValues): OrganizationSettings {
  const days = Object.fromEntries(
    DAYS.map((d) => {
      const entry = v.days[d.key];
      return [d.key, entry.enabled ? { open: entry.open, close: entry.close } : null];
    }),
  ) as NonNullable<OrganizationSettings['businessHours']>['days'];

  const ai: NonNullable<OrganizationSettings['ai']> = {};
  if (v.aiProvider) ai.defaultProvider = v.aiProvider;
  if (v.aiModel.trim()) ai.defaultModel = v.aiModel.trim();
  if (v.assistantName.trim()) ai.assistantName = v.assistantName.trim();
  if (v.tone) ai.tone = v.tone;

  const settings: OrganizationSettings = {
    businessHours: { timezone: v.hoursTimezone, days },
  };
  if (v.primaryColor) settings.branding = { primaryColor: v.primaryColor };
  if (Object.keys(ai).length > 0) settings.ai = ai;
  // Validate against the contract before sending so the server never sees an invalid payload.
  return organizationSettingsSchema.parse(settings);
}

function AssistantAndHoursForm({
  settings,
  readOnly,
}: {
  settings: OrganizationSettings;
  readOnly: boolean;
}) {
  const update = useUpdateOrganizationSettings();
  const organization = useOrganization();
  const fallbackTz = organization.data?.timezone ?? 'UTC';
  const [formError, setFormError] = React.useState<string | null>(null);

  const defaults = React.useMemo(() => toFormValues(settings, fallbackTz), [settings, fallbackTz]);
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: defaults,
  });
  React.useEffect(() => form.reset(defaults), [defaults, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await update.mutateAsync(toSettings(values));
      toast.success('Settings saved');
    } catch (error) {
      if (
        !applyServerErrors(error, form.setError, [
          'hoursTimezone',
          'primaryColor',
          'aiModel',
          'assistantName',
        ])
      ) {
        setFormError(getErrorMessage(error));
      }
    }
  });

  const tzValue = useWatch({ control: form.control, name: 'hoursTimezone' });
  const primaryColor = useWatch({ control: form.control, name: 'primaryColor' });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>Business hours and assistant defaults</CardTitle>
          <CardDescription>
            When the business is open, and how the assistant introduces itself and speaks.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-8">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <fieldset disabled={readOnly} className="flex flex-col gap-4">
            <legend className="mb-1 text-sm font-semibold">Business hours</legend>
            <FormField
              id="hours-tz"
              label="Hours are in"
              error={form.formState.errors.hoursTimezone?.message}
              className="sm:max-w-xs"
            >
              <NativeSelect {...form.register('hoursTimezone')}>
                {tzValue && !COMMON_TIMEZONES.includes(tzValue) ? (
                  <option value={tzValue}>{tzValue}</option>
                ) : null}
                {COMMON_TIMEZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <ul className="divide-y divide-border rounded-md border border-border">
              {DAYS.map((day) => (
                <DayRow key={day.key} day={day.key} label={day.label} form={form} />
              ))}
            </ul>
          </fieldset>

          <fieldset disabled={readOnly} className="flex flex-col gap-5">
            <legend className="mb-1 text-sm font-semibold">Assistant</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="assistant-name"
                label="Assistant name"
                description="How it introduces itself to customers."
                error={form.formState.errors.assistantName?.message}
              >
                <Input placeholder="e.g. Maya" {...form.register('assistantName')} />
              </FormField>
              <FormField
                id="assistant-tone"
                label="Tone"
                error={form.formState.errors.tone?.message}
              >
                <NativeSelect {...form.register('tone')}>
                  <option value="">Platform default</option>
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="concise">Concise</option>
                </NativeSelect>
              </FormField>
              <FormField
                id="ai-provider"
                label="Default AI provider"
                description="Provider credentials are configured in a later milestone."
                error={form.formState.errors.aiProvider?.message}
              >
                <NativeSelect {...form.register('aiProvider')}>
                  <option value="">Platform default</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                </NativeSelect>
              </FormField>
              <FormField
                id="ai-model"
                label="Default model"
                description="Leave empty to use the provider’s recommended model."
                error={form.formState.errors.aiModel?.message}
              >
                <Input
                  placeholder="e.g. claude-sonnet-4-5"
                  className="font-mono"
                  {...form.register('aiModel')}
                />
              </FormField>
            </div>
          </fieldset>

          <fieldset disabled={readOnly} className="flex flex-col gap-5">
            <legend className="mb-1 text-sm font-semibold">Branding</legend>
            <FormField
              id="primary-color"
              label="Primary colour"
              description="Used in customer-facing surfaces such as chat widgets."
              error={form.formState.errors.primaryColor?.message}
              className="sm:max-w-xs"
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick a colour"
                  value={/^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#0b7a75'}
                  onChange={(e) =>
                    form.setValue('primaryColor', e.target.value, { shouldDirty: true })
                  }
                  className="size-9 cursor-pointer rounded-sm border border-border bg-surface p-0.5"
                  disabled={readOnly}
                />
                <Input
                  placeholder="#0B7A75"
                  className="font-mono uppercase"
                  {...form.register('primaryColor')}
                />
              </div>
            </FormField>
          </fieldset>
        </CardContent>
        {readOnly ? null : (
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
              Save settings
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}

function DayRow({
  day,
  label,
  form,
}: {
  day: DayKey;
  label: string;
  form: ReturnType<typeof useForm<SettingsFormValues>>;
}) {
  const enabled = useWatch({ control: form.control, name: `days.${day}.enabled` });
  const closeError = form.formState.errors.days?.[day]?.close?.message;
  const openError = form.formState.errors.days?.[day]?.open?.message;
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex w-40 items-center gap-3">
        <Switch
          id={`day-${day}`}
          checked={enabled}
          onCheckedChange={(c) => form.setValue(`days.${day}.enabled`, c, { shouldDirty: true })}
          aria-label={`${label} open`}
        />
        <label htmlFor={`day-${day}`} className="text-sm font-medium">
          {label}
        </label>
      </div>
      {enabled ? (
        <div className="flex flex-1 flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-fg-muted">From</span>
            <Input
              type="time"
              step={300}
              className="w-32"
              invalid={!!openError}
              {...form.register(`days.${day}.open`)}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-fg-muted">to</span>
            <Input
              type="time"
              step={300}
              className="w-32"
              invalid={!!closeError}
              {...form.register(`days.${day}.close`)}
            />
          </label>
          {openError || closeError ? (
            <span role="alert" className="text-xs text-danger">
              {openError ?? closeError}
            </span>
          ) : null}
        </div>
      ) : (
        <span className="text-sm text-fg-subtle">Closed</span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

function DangerZone({ organization }: { organization: Organization | undefined }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canDelete = useCan(Permission.ORG_DELETE);
  const roleKey = useSession((s) => s.activeOrganization?.roleKey);
  const leave = useLeaveOrganization();
  const remove = useDeleteOrganization();
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [confirmName, setConfirmName] = React.useState('');

  const afterMembershipChange = async (message: string) => {
    const auth = await authApi.refresh();
    const session = useSession.getState();
    if (auth) session.applyAuthResponse(auth);
    session.setActiveOrganization(auth?.organizations[0]?.id ?? null);
    queryClient.removeQueries({ queryKey: ['org'] });
    toast.success(message);
    router.replace(auth && auth.organizations.length > 0 ? '/dashboard' : '/onboarding');
  };

  return (
    <Card className="border-danger/30">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
        <CardDescription>
          These actions affect your access or the whole organization.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border p-0">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Leave this organization</p>
            <p className="text-sm text-fg-muted">
              {roleKey === 'owner'
                ? 'Owners must transfer ownership before leaving.'
                : 'You’ll lose access immediately. Another member can invite you back.'}
            </p>
          </div>
          <Button
            variant="danger-outline"
            disabled={roleKey === 'owner'}
            onClick={() => setLeaveOpen(true)}
          >
            Leave organization
          </Button>
        </div>
        {canDelete ? (
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Delete this organization</p>
              <p className="text-sm text-fg-muted">
                Permanently removes members, roles, data and settings. This cannot be undone.
              </p>
            </div>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Delete organization
            </Button>
          </div>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave this organization?"
        description="You will be signed out of it and lose access to its data."
        confirmLabel="Leave organization"
        tone="danger"
        loading={leave.isPending}
        onConfirm={() =>
          leave.mutate(undefined, {
            onSuccess: () => void afterMembershipChange('You left the organization'),
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setConfirmName('');
        }}
        title="Delete this organization?"
        description="Type the organization name to confirm. Everything in it will be deleted permanently."
        confirmLabel="Delete permanently"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!organization || confirmName.trim() !== organization.name) {
            toast.error('The name you typed doesn’t match.');
            return;
          }
          remove.mutate(undefined, {
            onSuccess: () => void afterMembershipChange('Organization deleted'),
            onError: (e) => toast.error(getErrorMessage(e)),
          });
        }}
      >
        <FormField id="confirm-org-name" label={`Type “${organization?.name ?? ''}” to confirm`}>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
          />
        </FormField>
      </ConfirmDialog>
    </Card>
  );
}
