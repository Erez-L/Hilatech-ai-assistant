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

// ---------------------------------------------------------------------------
// Form-side schema: browser strings in, contract-valid request out.
// ---------------------------------------------------------------------------

function numberField(opts: {
  label: string;
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
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Enter ${label.toLowerCase()}` });
        return z.NEVER;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: integer ? 'Enter a whole number' : 'Enter a number',
        });
        return z.NEVER;
      }
      if (n < min || n > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be between ${min.toLocaleString('en')} and ${max.toLocaleString('en')}${unit}`,
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
    label: 'Temperature',
    min: 0,
    max: 2,
    integer: false,
    optional: true,
  }),
  maxOutputTokens: numberField({
    label: 'Max output tokens',
    min: 16,
    max: 64_000,
    optional: true,
  }),
  tools: z.array(z.string()).max(50, 'Pick at most 50 tools'),
  allowWrite: z.boolean(),
  allowDelegation: z.boolean(),
  delegateTo: z.array(z.string()),
  maxSteps: numberField({ label: 'Max steps', min: 1, max: AGENT_HARD_LIMITS.maxSteps }),
  maxDurationSec: numberField({
    label: 'Max duration',
    min: 1,
    max: AGENT_HARD_LIMITS.maxDurationMs / 1000,
    unit: ' seconds',
  }),
  maxTokens: numberField({ label: 'Max tokens', min: 1000, max: AGENT_HARD_LIMITS.maxTokens }),
  maxDelegations: numberField({
    label: 'Max delegations',
    min: 0,
    max: AGENT_HARD_LIMITS.maxDelegationsPerExecution,
  }),
  retryMaxAttempts: numberField({ label: 'Attempts', min: 1, max: 5 }),
  retryBackoffMs: numberField({ label: 'Backoff', min: 0, max: 60_000, unit: ' ms' }),
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
          <CardTitle>Basics</CardTitle>
          <CardDescription>What the agent is for and how it should behave.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField id="agent-name" label="Name" required error={errors.name?.message}>
            <Input placeholder="Lead follow-up assistant" {...form.register('name')} />
          </FormField>
          <FormField id="agent-description" label="Description" error={errors.description?.message}>
            <Textarea
              rows={2}
              placeholder="Short summary for your team"
              {...form.register('description')}
            />
          </FormField>
          <FormField
            id="agent-instructions"
            label="Instructions"
            required
            error={errors.instructions?.message}
            description="The system prompt: goals, tone, rules and when to use each tool."
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
                  aria-label="Enabled"
                />
              )}
            />
            <label htmlFor="agent-enabled" className="text-sm">
              Enabled <span className="text-fg-muted">— disabled agents cannot be run.</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>
            Leave the provider empty to use the organization default.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            {canReadConfig ? (
              <FormField
                id="agent-provider"
                label="Provider configuration"
                error={errors.providerConfigId?.message}
              >
                <NativeSelect {...form.register('providerConfigId')}>
                  <option value="">Organization default</option>
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
              label="Model"
              error={errors.model?.message}
              description="Pick a known model or type any model id."
            >
              <Input
                list="agent-models"
                placeholder="Provider default"
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
              label="Temperature"
              error={errors.temperature?.message}
              description="0 – 2. Empty uses the model default."
            >
              <Input inputMode="decimal" placeholder="Default" {...form.register('temperature')} />
            </FormField>
            <FormField
              id="agent-max-output"
              label="Max output tokens"
              error={errors.maxOutputTokens?.message}
              description="Per model call. Empty uses the model default."
            >
              <Input
                inputMode="numeric"
                placeholder="Default"
                {...form.register('maxOutputTokens')}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tools</CardTitle>
          <CardDescription>
            The agent can only call the tools you select, and only with permissions it holds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tools.isPending ? (
            <div className="flex flex-col gap-2" aria-busy>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : tools.isError ? (
            <Alert tone="danger">
              The tool catalogue could not be loaded. Reload the page to retry.
            </Alert>
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
          <CardTitle>Permissions</CardTitle>
          <CardDescription>
            Dangerous tools never run autonomously, whatever is selected here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Controller
            control={form.control}
            name="allowWrite"
            render={({ field }) => (
              <FormField
                id="agent-allow-write"
                inline
                label="Allow write actions"
                description="Lets the agent call tools that create or change records."
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
                label="Allow delegation"
                description="Lets the agent hand sub-tasks to other agents."
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
                      Agents it may delegate to
                    </legend>
                    <p className="text-xs text-fg-subtle">
                      Select none to allow any enabled agent in the organization.
                    </p>
                    {candidates.length === 0 ? (
                      <p className="text-sm text-fg-muted">There are no other agents yet.</p>
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
          <CardTitle>Limits &amp; retries</CardTitle>
          <CardDescription>
            Every run stops at these limits. The platform ceilings are the maximum allowed values.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="agent-max-steps"
              label="Max steps"
              error={errors.maxSteps?.message}
              description={`1 – ${AGENT_HARD_LIMITS.maxSteps}`}
            >
              <Input inputMode="numeric" className="tabular" {...form.register('maxSteps')} />
            </FormField>
            <FormField
              id="agent-max-duration"
              label="Max duration (seconds)"
              error={errors.maxDurationSec?.message}
              description={`1 – ${AGENT_HARD_LIMITS.maxDurationMs / 1000}`}
            >
              <Input inputMode="numeric" className="tabular" {...form.register('maxDurationSec')} />
            </FormField>
            <FormField
              id="agent-max-tokens"
              label="Max tokens per run"
              error={errors.maxTokens?.message}
              description={`1,000 – ${AGENT_HARD_LIMITS.maxTokens.toLocaleString('en')}`}
            >
              <Input inputMode="numeric" className="tabular" {...form.register('maxTokens')} />
            </FormField>
            <FormField
              id="agent-max-delegations"
              label="Max delegations"
              error={errors.maxDelegations?.message}
              description={`0 – ${AGENT_HARD_LIMITS.maxDelegationsPerExecution}`}
            >
              <Input inputMode="numeric" className="tabular" {...form.register('maxDelegations')} />
            </FormField>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="agent-retry-attempts"
              label="Retry attempts"
              error={errors.retryMaxAttempts?.message}
              description="1 – 5, for retryable provider errors"
            >
              <Input
                inputMode="numeric"
                className="tabular"
                {...form.register('retryMaxAttempts')}
              />
            </FormField>
            <FormField
              id="agent-retry-backoff"
              label="Retry backoff (ms)"
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
