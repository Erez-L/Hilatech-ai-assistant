'use client';

import * as React from 'react';
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AGENT_HARD_LIMITS,
  Permission,
  createAgentSchema,
  type Agent,
  type AiProviderConfig,
  type CreateAgentRequest,
  type ToolDefinition,
} from '@hilatech/contracts';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  FormField,
  Input,
  NativeSelect,
  Skeleton,
  Switch,
  Textarea,
} from '@hilatech/ui';
import { isApiError } from '@/lib/api';
import { useAgents, useAiModels, useAiProviders, useAiTools } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { extractIssues } from '@/lib/forms/server-errors';
import { ToolsPicker } from '@/components/ai/tools-picker';
import { useT, useFormat } from '@/i18n/provider';
import type { MessageKey } from '@/i18n/messages';
import { vm } from '@/i18n/validation';

// ---------------------------------------------------------------------------
// Form-side schema: browser strings in, contract-valid request out.
// ---------------------------------------------------------------------------

function numberField(opts: {
  label: MessageKey;
  min: number;
  max: number;
  integer?: boolean;
  optional?: boolean;
  unit?: string;
}) {
  const { label, min, max, integer = true, optional = false, unit = '' } = opts;
  return z
    .string()
    .trim()
    .transform((raw, ctx): number | '' => {
      if (raw === '') {
        if (optional) return '';
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: vm('validation.enterField', { label }),
        });
        return z.NEVER;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: vm(integer ? 'validation.wholeNumber' : 'validation.number'),
        });
        return z.NEVER;
      }
      if (n < min || n > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: vm(
            unit === ' seconds'
              ? 'validation.rangeFieldSeconds'
              : unit === ' ms'
                ? 'validation.rangeFieldMs'
                : 'validation.rangeField',
            { label, min, max },
          ),
        });
        return z.NEVER;
      }
      return n;
    });
}

export const agentFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Keep the name under 120 characters'),
  description: z.string().trim().max(2000, 'Keep the description under 2000 characters'),
  instructions: z
    .string()
    .trim()
    .min(1, 'Write the instructions the agent should follow')
    .max(50_000, 'Keep the instructions under 50,000 characters'),
  providerConfigId: z.string(),
  model: z.string().trim().max(120, 'Keep the model name under 120 characters'),
  temperature: numberField({
    label: 'agents.temperature',
    min: 0,
    max: 2,
    integer: false,
    optional: true,
  }),
  maxOutputTokens: numberField({
    label: 'agents.maxOutputTokens',
    min: 16,
    max: 64_000,
    optional: true,
  }),
  tools: z.array(z.string()).max(50, 'Pick at most 50 tools'),
  allowWrite: z.boolean(),
  allowDelegation: z.boolean(),
  delegateTo: z.array(z.string()),
  maxSteps: numberField({ label: 'agents.maxSteps', min: 1, max: AGENT_HARD_LIMITS.maxSteps }),
  maxDurationSec: numberField({
    label: 'agents.maxDuration',
    min: 1,
    max: AGENT_HARD_LIMITS.maxDurationMs / 1000,
    unit: ' seconds',
  }),
  maxTokens: numberField({
    label: 'agents.maxTokens',
    min: 1000,
    max: AGENT_HARD_LIMITS.maxTokens,
  }),
  maxDelegations: numberField({
    label: 'agents.maxDelegations',
    min: 0,
    max: AGENT_HARD_LIMITS.maxDelegationsPerExecution,
  }),
  retryMaxAttempts: numberField({ label: 'agents.attempts', min: 1, max: 5 }),
  retryBackoffMs: numberField({ label: 'agents.backoff', min: 0, max: 60_000, unit: ' ms' }),
  isEnabled: z.boolean(),
});
export type AgentFormInput = z.input<typeof agentFormSchema>;
export type AgentFormValues = z.output<typeof agentFormSchema>;

export function agentFormDefaults(agent?: Agent | null): AgentFormInput {
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    instructions: agent?.instructions ?? '',
    providerConfigId: agent?.providerConfigId ?? '',
    model: agent?.model ?? '',
    temperature: agent?.temperature == null ? '' : String(agent.temperature),
    maxOutputTokens: agent?.maxOutputTokens == null ? '' : String(agent.maxOutputTokens),
    tools: agent?.tools ?? [],
    allowWrite: agent?.permissions.allowWrite ?? false,
    allowDelegation: agent?.permissions.allowDelegation ?? false,
    delegateTo: agent?.permissions.delegateTo ?? [],
    maxSteps: String(agent?.maxSteps ?? 12),
    maxDurationSec: String(Math.round((agent?.maxDurationMs ?? 120_000) / 1000)),
    maxTokens: String(agent?.maxTokens ?? 150_000),
    maxDelegations: String(agent?.maxDelegations ?? 3),
    retryMaxAttempts: String(agent?.retryPolicy.maxAttempts ?? 2),
    retryBackoffMs: String(agent?.retryPolicy.backoffMs ?? 2000),
    isEnabled: agent?.isEnabled ?? true,
  };
}

/**
 * Maps validated form values onto the contract request (authoritative parse through
 * `createAgentSchema`). Empty optional fields are omitted: the update contract cannot clear them.
 */
export function toAgentRequest(values: AgentFormValues): CreateAgentRequest {
  return createAgentSchema.parse({
    name: values.name,
    description: values.description || undefined,
    instructions: values.instructions,
    providerConfigId: values.providerConfigId || undefined,
    model: values.model || undefined,
    temperature: values.temperature === '' ? undefined : values.temperature,
    maxOutputTokens: values.maxOutputTokens === '' ? undefined : values.maxOutputTokens,
    tools: values.tools,
    permissions: {
      allowWrite: values.allowWrite,
      allowDelegation: values.allowDelegation,
      delegateTo: values.allowDelegation ? values.delegateTo : [],
    },
    maxSteps: values.maxSteps,
    maxDurationMs: (values.maxDurationSec as number) * 1000,
    maxTokens: values.maxTokens,
    maxDelegations: values.maxDelegations,
    retryPolicy: { maxAttempts: values.retryMaxAttempts, backoffMs: values.retryBackoffMs },
    isEnabled: values.isEnabled,
  });
}

export const AGENT_FORM_FIELDS = Object.keys(agentFormSchema.shape) as (keyof AgentFormInput)[];

const SERVER_PATH_TO_FIELD: Record<string, keyof AgentFormInput> = {
  maxDurationMs: 'maxDurationSec',
  'permissions.allowWrite': 'allowWrite',
  'permissions.allowDelegation': 'allowDelegation',
  'permissions.delegateTo': 'delegateTo',
  'retryPolicy.maxAttempts': 'retryMaxAttempts',
  'retryPolicy.backoffMs': 'retryBackoffMs',
};

/** Maps a VALIDATION_ERROR / CONFLICT response onto form fields. Returns true when a field got an error. */
export function applyAgentServerErrors(
  error: unknown,
  setError: UseFormReturn<AgentFormInput, unknown, AgentFormValues>['setError'],
): boolean {
  if (!isApiError(error)) return false;
  if (error.code === 'CONFLICT' && /name/i.test(error.message)) {
    // i18n-ignore: form field name, not UI text
    setError('name', { type: 'server', message: error.message });
    return true;
  }
  if (!error.isValidation) return false;
  let applied = false;
  for (const issue of extractIssues(error.details)) {
    const root = issue.path.split('.').slice(0, 2).join('.');
    const field =
      SERVER_PATH_TO_FIELD[issue.path] ??
      SERVER_PATH_TO_FIELD[root] ??
      AGENT_FORM_FIELDS.find((f) => f === issue.path || issue.path.startsWith(`${f}.`));
    if (field) {
      setError(field, { type: 'server', message: issue.message });
      applied = true;
    }
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export function AgentFormFields({
  form,
  agentId,
  disabled = false,
}: {
  form: UseFormReturn<AgentFormInput, unknown, AgentFormValues>;
  /** Present when editing: the agent is excluded from its own delegation targets. */
  agentId?: string;
  disabled?: boolean;
}) {
  const fmt = useFormat();
  const t = useT();
  const errors = form.formState.errors;
  const canReadConfig = useCan(Permission.AI_CONFIG_READ);
  const providers = useAiProviders({ enabled: canReadConfig });
  const tools = useAiTools();
  const others = useAgents({ page: 1, pageSize: 100 });

  const providerConfigId = useWatch({ control: form.control, name: 'providerConfigId' });
  const allowWrite = useWatch({ control: form.control, name: 'allowWrite' });
  const allowDelegation = useWatch({ control: form.control, name: 'allowDelegation' });
  const providerList: AiProviderConfig[] = providers.data ?? [];
  const selectedProvider =
    providerList.find((p) => p.id === providerConfigId) ?? providerList.find((p) => p.isDefault);
  const models = useAiModels(selectedProvider?.provider ?? null, { enabled: canReadConfig });

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('agents.basics')}</CardTitle>
          <CardDescription>{t('agents.whatTheAgentIsFor')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField id="agent-name" label={t('common.name')} required error={errors.name?.message}>
            <Input placeholder={t('agents.leadFollowUpAssistant')} {...form.register('name')} />
          </FormField>
          <FormField
            id="agent-description"
            label={t('common.description')}
            error={errors.description?.message}
          >
            <Textarea
              rows={2}
              placeholder={t('agents.shortSummaryForYourTeam')}
              {...form.register('description')}
            />
          </FormField>
          <FormField
            id="agent-instructions"
            label={t('agents.instructions')}
            required
            error={errors.instructions?.message}
            description={t('agents.theSystemPromptGoalsTone')}
          >
            <Textarea rows={10} className="font-mono text-xs" {...form.register('instructions')} />
          </FormField>
          <div className="flex items-center gap-3">
            <Controller
              control={form.control}
              name="isEnabled"
              render={({ field }) => (
                <Switch
                  id="agent-enabled"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label={t('common.enabled')}
                />
              )}
            />
            <label htmlFor="agent-enabled" className="text-sm">
              {t('common.enabled')}{' '}
              <span className="text-fg-muted">{t('agents.disabledAgentsCannotBeRun')}</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('common.model')}</CardTitle>
          <CardDescription>{t('agents.leaveTheProviderEmptyTo')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            {canReadConfig ? (
              <FormField
                id="agent-provider"
                label={t('agents.providerConfiguration')}
                error={errors.providerConfigId?.message}
              >
                <NativeSelect {...form.register('providerConfigId')}>
                  <option value="">{t('common.organizationDefault')}</option>
                  {providerList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.provider})
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}
            <FormField
              id="agent-model"
              label={t('common.model')}
              error={errors.model?.message}
              description={t('agents.pickAKnownModelOr')}
            >
              <Input
                list="agent-models"
                placeholder={t('agents.providerDefault')}
                {...form.register('model')}
              />
            </FormField>
            <datalist id="agent-models">
              {(models.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </datalist>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="agent-temperature"
              label={t('agents.temperature')}
              error={errors.temperature?.message}
              description={t('agents.n02EmptyUsesThe')}
            >
              <Input
                inputMode="decimal"
                placeholder={t('common.default')}
                {...form.register('temperature')}
              />
            </FormField>
            <FormField
              id="agent-max-output"
              label={t('agents.maxOutputTokens')}
              error={errors.maxOutputTokens?.message}
              description={t('agents.perModelCallEmptyUses')}
            >
              <Input
                inputMode="numeric"
                placeholder={t('common.default')}
                {...form.register('maxOutputTokens')}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('agents.tools')}</CardTitle>
          <CardDescription>{t('agents.theAgentCanOnlyCall')}</CardDescription>
        </CardHeader>
        <CardContent>
          {tools.isPending ? (
            <div className="flex flex-col gap-2" aria-busy>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : tools.isError ? (
            <Alert tone="danger">{t('agents.theToolCatalogueCouldNot')}</Alert>
          ) : (
            <Controller
              control={form.control}
              name="tools"
              render={({ field }) => (
                <ToolsPicker
                  tools={tools.data as ToolDefinition[]}
                  value={field.value}
                  onChange={field.onChange}
                  allowWrite={allowWrite}
                  disabled={disabled}
                />
              )}
            />
          )}
          {errors.tools?.message ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {errors.tools.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('common.permissions')}</CardTitle>
          <CardDescription>{t('agents.dangerousToolsNeverRunAutonomously')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Controller
            control={form.control}
            name="allowWrite"
            render={({ field }) => (
              <FormField
                id="agent-allow-write"
                inline
                label={t('agents.allowWriteActions')}
                description={t('agents.letsTheAgentCallTools')}
              >
                <Checkbox
                  id="agent-allow-write"
                  checked={field.value}
                  onCheckedChange={(c) => field.onChange(c === true)}
                />
              </FormField>
            )}
          />
          <Controller
            control={form.control}
            name="allowDelegation"
            render={({ field }) => (
              <FormField
                id="agent-allow-delegation"
                inline
                label={t('agents.allowDelegation')}
                description={t('agents.letsTheAgentHandSub')}
              >
                <Checkbox
                  id="agent-allow-delegation"
                  checked={field.value}
                  onCheckedChange={(c) => field.onChange(c === true)}
                />
              </FormField>
            )}
          />
          {allowDelegation ? (
            <Controller
              control={form.control}
              name="delegateTo"
              render={({ field }) => {
                const candidates = (others.data?.data ?? []).filter((a) => a.id !== agentId);
                return (
                  <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-medium text-fg-muted">
                      {t('agents.agentsItMayDelegateTo')}
                    </legend>
                    <p className="text-xs text-fg-subtle">{t('agents.selectNoneToAllowAny')}</p>
                    {candidates.length === 0 ? (
                      <p className="text-sm text-fg-muted">{t('agents.thereAreNoOtherAgents')}</p>
                    ) : (
                      candidates.map((a) => (
                        <div key={a.id} className="flex items-center gap-2.5">
                          <Checkbox
                            id={`delegate-${a.id}`}
                            checked={field.value.includes(a.id)}
                            onCheckedChange={(c) =>
                              field.onChange(
                                c === true
                                  ? Array.from(new Set([...field.value, a.id]))
                                  : field.value.filter((x) => x !== a.id),
                              )
                            }
                          />
                          <label htmlFor={`delegate-${a.id}`} className="text-sm">
                            {a.name}
                          </label>
                        </div>
                      ))
                    )}
                  </fieldset>
                );
              }}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('agents.limitsRetries')}</CardTitle>
          <CardDescription>{t('agents.everyRunStopsAtThese')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="agent-max-steps"
              label={t('agents.maxSteps')}
              error={errors.maxSteps?.message}
              description={`1 – ${AGENT_HARD_LIMITS.maxSteps}`}
            >
              <Input inputMode="numeric" className="tabular" {...form.register('maxSteps')} />
            </FormField>
            <FormField
              id="agent-max-duration"
              label={t('agents.maxDurationSeconds')}
              error={errors.maxDurationSec?.message}
              description={`1 – ${AGENT_HARD_LIMITS.maxDurationMs / 1000}`}
            >
              <Input inputMode="numeric" className="tabular" {...form.register('maxDurationSec')} />
            </FormField>
            <FormField
              id="agent-max-tokens"
              label={t('agents.maxTokensPerRun')}
              error={errors.maxTokens?.message}
              description={`1,000 – ${fmt.number(AGENT_HARD_LIMITS.maxTokens)}`}
            >
              <Input inputMode="numeric" className="tabular" {...form.register('maxTokens')} />
            </FormField>
            <FormField
              id="agent-max-delegations"
              label={t('agents.maxDelegations')}
              error={errors.maxDelegations?.message}
              description={`0 – ${AGENT_HARD_LIMITS.maxDelegationsPerExecution}`}
            >
              <Input inputMode="numeric" className="tabular" {...form.register('maxDelegations')} />
            </FormField>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="agent-retry-attempts"
              label={t('agents.retryAttempts')}
              error={errors.retryMaxAttempts?.message}
              description={t('agents.n15ForRetryableProvider')}
            >
              <Input
                inputMode="numeric"
                className="tabular"
                {...form.register('retryMaxAttempts')}
              />
            </FormField>
            <FormField
              id="agent-retry-backoff"
              label={t('agents.retryBackoffMs')}
              error={errors.retryBackoffMs?.message}
              description="0 – 60,000"
            >
              <Input inputMode="numeric" className="tabular" {...form.register('retryBackoffMs')} />
            </FormField>
          </div>
        </CardContent>
      </Card>
    </fieldset>
  );
}

/** Convenience hook so pages and tests build the form identically. */
export function useAgentForm(agent?: Agent | null) {
  return useForm<AgentFormInput, unknown, AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: agentFormDefaults(agent),
  });
}
