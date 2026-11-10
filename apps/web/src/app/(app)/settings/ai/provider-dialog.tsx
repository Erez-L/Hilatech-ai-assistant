'use client';

import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AiProviderKind,
  createAiProviderConfigSchema,
  updateAiProviderConfigSchema,
  type AiProviderConfig,
  type CreateAiProviderConfigRequest,
  type UpdateAiProviderConfigRequest,
} from '@hilatech/contracts';
import {
  Alert,
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  NativeSelect,
  Switch,
  toast,
  type ComboboxItem,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useAiModels, useCreateAiProvider, useUpdateAiProvider } from '@/hooks/queries';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { useT } from '@/i18n/provider';

/** The deterministic mock provider is for development; production builds hide it unless opted in. */
export const MOCK_PROVIDER_ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_MOCK_AI === 'true';

export const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  bedrock: 'Amazon Bedrock',
  mock: 'Mock (development)',
};

export const providerFormSchema = z.object({
  provider: AiProviderKind,
  name: z.string().trim().min(1, 'Enter a name').max(80, 'Keep the name under 80 characters'),
  apiKey: z
    .string()
    .trim()
    .refine((v) => v === '' || (v.length >= 8 && v.length <= 512), 'The API key looks too short'),
  baseUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || z.string().url().safeParse(v).success, 'Enter a valid URL'),
  region: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^[a-z]{2}(-[a-z]+)+-\d$/.test(v),
      'Use an AWS region such as us-east-1',
    )
    .optional(),
  defaultModel: z.string().trim().min(1, 'Choose a default model').max(120),
  embeddingModel: z.string().trim().max(120),
  isDefault: z.boolean(),
  isEnabled: z.boolean(),
  clearApiKey: z.boolean(),
});
export type ProviderFormValues = z.infer<typeof providerFormSchema>;
const PROVIDER_FORM_FIELDS = Object.keys(providerFormSchema.shape) as (keyof ProviderFormValues)[];

/**
 * Builds the API body. The key is write-only: on update a blank key field means “keep the stored
 * key” and the field is simply omitted (never sent as an empty string).
 */
export function buildProviderRequest(
  values: ProviderFormValues,
  editing: boolean,
): CreateAiProviderConfigRequest | UpdateAiProviderConfigRequest {
  const common = {
    name: values.name,
    // Bedrock authenticates with the server's IAM identity: no key and no endpoint override are sent.
    apiKey: values.provider === 'bedrock' ? undefined : values.apiKey || undefined,
    baseUrl: values.provider === 'bedrock' ? undefined : values.baseUrl || undefined,
    ...(values.provider === 'bedrock' && values.region ? { region: values.region } : {}),
    defaultModel: values.defaultModel,
    embeddingModel: values.embeddingModel || undefined,
    isDefault: values.isDefault,
    isEnabled: values.isEnabled,
  };
  if (!editing) return createAiProviderConfigSchema.parse({ provider: values.provider, ...common });
  return updateAiProviderConfigSchema.parse({
    ...common,
    ...(values.clearApiKey && !values.apiKey ? { clearApiKey: true } : {}),
  });
}

export interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing configuration to edit; undefined creates a new one. */
  provider?: AiProviderConfig;
  /** True when no provider exists yet — the first one is made the default. */
  first?: boolean;
}

export function ProviderDialog({ open, onOpenChange, provider, first }: ProviderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <ProviderForm
          key={provider?.id ?? 'new'}
          provider={provider}
          first={first}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProviderForm({
  provider,
  first,
  onDone,
}: {
  provider?: AiProviderConfig;
  first?: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const editing = !!provider;
  const create = useCreateAiProvider();
  const update = useUpdateAiProvider();
  const [formError, setFormError] = React.useState<string | null>(null);

  const initialKind: AiProviderKind = provider?.provider ?? 'anthropic';
  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: {
      provider: initialKind,
      name: provider?.name ?? '',
      apiKey: '',
      baseUrl: provider?.baseUrl ?? '',
      region: provider?.region ?? '',
      defaultModel: provider?.defaultModel ?? '',
      embeddingModel: provider?.embeddingModel ?? '',
      isDefault: provider?.isDefault ?? !!first,
      isEnabled: provider?.isEnabled ?? true,
      clearApiKey: false,
    },
  });
  const errors = form.formState.errors;
  const kind = useWatch({ control: form.control, name: 'provider' });
  const clearApiKey = useWatch({ control: form.control, name: 'clearApiKey' });
  const defaultModel = useWatch({ control: form.control, name: 'defaultModel' });
  const models = useAiModels(kind);

  const chatModels: ComboboxItem[] = React.useMemo(
    () =>
      (models.data ?? [])
        .filter((m) => !m.supportsEmbeddings)
        .map((m) => ({
          value: m.id,
          label: m.displayName,
          description: m.availabilityNote ? `${m.id} - ${m.availabilityNote}` : m.id,
        })),
    [models.data],
  );
  const embeddingModels: ComboboxItem[] = React.useMemo(
    () =>
      (models.data ?? [])
        .filter((m) => m.supportsEmbeddings)
        .map((m) => ({
          value: m.id,
          label: m.displayName,
          description: m.availabilityNote ? `${m.id} - ${m.availabilityNote}` : m.id,
        })),
    [models.data],
  );

  // Creating: pre-select the first model of the chosen provider.
  React.useEffect(() => {
    if (editing || !models.data) return;
    if (!defaultModel || !chatModels.some((m) => m.value === defaultModel)) {
      form.setValue('defaultModel', chatModels[0]?.value ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, models.data, kind]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    if (!editing && values.provider !== 'mock' && values.provider !== 'bedrock' && !values.apiKey) {
      form.setError('apiKey', { type: 'required', message: t('settings.anApiKeyIsRequired') });
      return;
    }
    try {
      // The kind select is disabled while editing, so take the kind from the stored configuration.
      const body = buildProviderRequest(
        { ...values, provider: provider?.provider ?? values.provider },
        editing,
      );
      if (provider) {
        await update.mutateAsync({ id: provider.id, body: body as UpdateAiProviderConfigRequest });
        toast.success(t('settings.providerSaved', { name: values.name }));
      } else {
        await create.mutateAsync(body as CreateAiProviderConfigRequest);
        toast.success(t('settings.providerAdded', { name: values.name }));
      }
      onDone();
    } catch (error) {
      if (!applyServerErrors(error, form.setError, PROVIDER_FORM_FIELDS))
        setFormError(getErrorMessage(error));
    }
  });

  const needsKey = kind !== 'mock' && kind !== 'bedrock';

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>
          {editing ? t('common.edit2', { name: provider.name }) : t('settings.addAnAiProvider')}
        </DialogTitle>
        <DialogDescription>{t('settings.keysAreEncryptedAndNever')}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="provider-kind"
            label={t('settings.provider')}
            error={errors.provider?.message}
            required
          >
            <NativeSelect disabled={editing} {...form.register('provider')}>
              {AiProviderKind.options
                .filter(
                  (k) => k !== 'mock' || MOCK_PROVIDER_ENABLED || provider?.provider === 'mock',
                )
                .map((k) => (
                  <option key={k} value={k}>
                    {PROVIDER_LABELS[k]}
                  </option>
                ))}
            </NativeSelect>
          </FormField>
          <FormField
            id="provider-name"
            label={t('common.name')}
            error={errors.name?.message}
            required
          >
            <Input placeholder={t('settings.production')} autoFocus {...form.register('name')} />
          </FormField>
        </div>

        {needsKey ? (
          <FormField
            id="provider-key"
            label={t('settings.apiKey')}
            error={errors.apiKey?.message}
            required={!editing}
            description={
              editing
                ? provider?.hasApiKey
                  ? t('settings.storedKeyLeaveBlank', { last4: provider.keyLast4 ?? '' })
                  : t('settings.noKeyIsStoredEnter')
                : t('settings.pasteTheSecretKeyFrom')
            }
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={editing && provider?.hasApiKey ? '••••••••••••' : t('settings.sk')}
              disabled={clearApiKey}
              {...form.register('apiKey')}
            />
          </FormField>
        ) : kind === 'bedrock' ? (
          <>
            <Alert tone="neutral">{t('settings.amazonBedrockUsesTheServer')}</Alert>
            <FormField
              id="provider-region"
              label={t('settings.awsRegion')}
              error={errors.region?.message}
              description={t('settings.optionalLeaveBlankToUse')}
            >
              <Input
                placeholder={t('settings.usEast1')}
                spellCheck={false}
                {...form.register('region')}
              />
            </FormField>
          </>
        ) : (
          <Alert tone="neutral">{t('settings.theMockProviderAnswersDeterministically')}</Alert>
        )}
        {editing && provider?.hasApiKey && needsKey ? (
          <Controller
            control={form.control}
            name="clearApiKey"
            render={({ field }) => (
              <FormField
                id="provider-clear-key"
                inline
                label={t('settings.removeTheStoredKey')}
                description={t('settings.theProviderStaysUnusableUntil')}
              >
                <input
                  id="provider-clear-key"
                  type="checkbox"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
              </FormField>
            )}
          />
        ) : null}

        {kind !== 'bedrock' ? (
          <FormField
            id="provider-base-url"
            label={t('common.baseUrl')}
            error={errors.baseUrl?.message}
            description={t('settings.optionalOnlyForProxiesOr')}
          >
            <Input
              inputMode="url"
              placeholder={t('settings.https')}
              {...form.register('baseUrl')}
            />
          </FormField>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="provider-default-model"
            label={t('settings.defaultModel')}
            error={errors.defaultModel?.message}
            required
            description={kind === 'bedrock' ? t('settings.typeTheExactModelOr') : undefined}
          >
            {kind === 'bedrock' ? (
              <>
                <Input
                  id="provider-default-model"
                  list="bedrock-chat-models"
                  spellCheck={false}
                  placeholder={t('settings.amazonNovaMicroV10')}
                  {...form.register('defaultModel')}
                />
                <datalist id="bedrock-chat-models">
                  {chatModels.map((m) => (
                    <option key={m.value} value={m.value} label={m.description} />
                  ))}
                </datalist>
              </>
            ) : (
              <Controller
                control={form.control}
                name="defaultModel"
                render={({ field }) => (
                  <Combobox
                    id="provider-default-model"
                    items={chatModels}
                    value={field.value || null}
                    selectedLabel={field.value}
                    loading={models.isPending}
                    placeholder={t('settings.chooseAModel')}
                    searchPlaceholder={t('settings.searchModels')}
                    onValueChange={(v) => field.onChange(v ?? '')}
                  />
                )}
              />
            )}
          </FormField>
          <FormField
            id="provider-embedding-model"
            label={t('settings.embeddingModel')}
            error={errors.embeddingModel?.message}
            description={t('settings.optionalUsedForKnowledgeSearch')}
          >
            {kind === 'bedrock' ? (
              <>
                <Input
                  id="provider-embedding-model"
                  list="bedrock-embedding-models"
                  spellCheck={false}
                  placeholder={t('settings.amazonTitanEmbedTextV2')}
                  {...form.register('embeddingModel')}
                />
                <datalist id="bedrock-embedding-models">
                  {embeddingModels.map((m) => (
                    <option key={m.value} value={m.value} label={m.description} />
                  ))}
                </datalist>
              </>
            ) : (
              <Controller
                control={form.control}
                name="embeddingModel"
                render={({ field }) => (
                  <Combobox
                    id="provider-embedding-model"
                    items={embeddingModels}
                    value={field.value || null}
                    selectedLabel={field.value}
                    clearable
                    loading={models.isPending}
                    placeholder={t('common.none')}
                    searchPlaceholder={t('settings.searchModels')}
                    emptyMessage={t('settings.noEmbeddingModelsForThis')}
                    onValueChange={(v) => field.onChange(v ?? '')}
                  />
                )}
              />
            )}
          </FormField>
        </div>

        <div className="flex flex-col gap-3">
          <Controller
            control={form.control}
            name="isDefault"
            render={({ field }) => (
              <div className="flex items-center gap-3">
                <Switch
                  id="provider-default"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label={t('settings.useAsTheDefaultProvider')}
                />
                <label htmlFor="provider-default" className="text-sm">
                  {t('settings.useAsTheDefaultProvider')}
                </label>
              </div>
            )}
          />
          <Controller
            control={form.control}
            name="isEnabled"
            render={({ field }) => (
              <div className="flex items-center gap-3">
                <Switch
                  id="provider-enabled"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label={t('common.enabled')}
                />
                <label htmlFor="provider-enabled" className="text-sm">
                  {t('common.enabled')}
                </label>
              </div>
            )}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {editing ? t('common.saveChanges') : t('settings.addProvider')}
        </Button>
      </DialogFooter>
    </form>
  );
}
