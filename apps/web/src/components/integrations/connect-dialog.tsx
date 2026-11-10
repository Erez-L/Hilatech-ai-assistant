'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  createIntegrationSchema,
  updateIntegrationSchema,
  type Integration,
  type IntegrationSecrets,
} from '@hilatech/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
  NativeSelect,
  Switch,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useConnectIntegration, useUpdateIntegration } from '@/hooks/integrations';
import { KeyValueEditor } from '@/components/automation/key-value-editor';
import { serverFieldErrors, zodFieldErrors } from '@/lib/forms/zod-errors';
import { useT } from '@/i18n/provider';

type AuthType = 'none' | 'bearer' | 'basic' | 'header';

const KIND_TITLES = { rest: 'REST / Webhook', n8n: 'n8n' } as const;

function str(config: Record<string, unknown> | undefined, key: string, fallback = ''): string {
  const v = config?.[key];
  return typeof v === 'string' ? v : fallback;
}

/** Maps API/zod paths (`config.baseUrl`, `secrets.accessToken`) onto this form's field names. */
function normalizeErrors(found: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(found)) {
    out[path.replace(/^config\./, '').replace(/^secrets\./, 'secret.')] = message;
  }
  return out;
}

export function ConnectDialog({
  kind,
  integration,
  onClose,
}: {
  kind: 'rest' | 'n8n';
  /** Existing connection to edit; omit to connect a new one. */
  integration?: Integration;
  onClose: () => void;
}) {
  const t = useT();
  const connect = useConnectIntegration();
  const update = useUpdateIntegration();
  const editing = !!integration;
  const cfg = integration?.config;
  const [name, setName] = React.useState(
    integration?.name ?? (kind === 'rest' ? 'REST API' : 'n8n'),
  );
  const [baseUrl, setBaseUrl] = React.useState(str(cfg, 'baseUrl'));
  const [authType, setAuthType] = React.useState<AuthType>(
    (str(cfg, 'authType', 'none') as AuthType) || 'none',
  );
  const [authHeaderName, setAuthHeaderName] = React.useState(str(cfg, 'authHeaderName'));
  const [headers, setHeaders] = React.useState<Record<string, string>>(
    (cfg?.headers as Record<string, string> | undefined) ?? {},
  );
  const [prefix, setPrefix] = React.useState(str(cfg, 'webhookPathPrefix', '/webhook'));
  const [isEnabled, setIsEnabled] = React.useState(integration?.isEnabled ?? true);
  const [secrets, setSecrets] = React.useState<Record<string, string>>({});
  const [cleared, setCleared] = React.useState<Set<string>>(new Set());
  const [reveal, setReveal] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const stored = new Set(integration?.secretKeys ?? []);

  const secretFields: { key: keyof IntegrationSecrets; label: string }[] =
    kind === 'n8n'
      ? [{ key: 'apiKey', label: t('integrations.apiKeyOptional') }]
      : authType === 'bearer'
        ? [{ key: 'accessToken', label: t('integrations.bearerToken') }]
        : authType === 'basic'
          ? [
              { key: 'username', label: t('integrations.username') },
              { key: 'password', label: t('common.password') },
            ]
          : authType === 'header'
            ? [{ key: 'apiKey', label: t('integrations.headerValue') }]
            : [];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const config =
      kind === 'rest'
        ? {
            kind: 'rest' as const,
            baseUrl,
            headers,
            authType,
            authHeaderName: authType === 'header' ? authHeaderName || undefined : undefined,
          }
        : { kind: 'n8n' as const, baseUrl, webhookPathPrefix: prefix };
    const out: Record<string, string> = {};
    for (const { key } of secretFields) {
      if (cleared.has(key)) out[key] = '';
      else if (secrets[key]) out[key] = secrets[key] as string;
    }
    // Credentials not used by the chosen auth type are removed when editing.
    if (editing) {
      for (const key of stored) {
        if (!secretFields.some((f) => f.key === key) && key !== 'headers') out[key] = '';
      }
    }
    const secretBody = Object.keys(out).length > 0 ? out : undefined;
    try {
      if (editing && integration) {
        const parsed = updateIntegrationSchema.safeParse({
          name,
          config,
          secrets: secretBody,
          isEnabled,
        });
        if (!parsed.success) {
          setErrors(normalizeErrors(zodFieldErrors(parsed.error)));
          return;
        }
        setErrors({});
        await update.mutateAsync({ id: integration.id, body: parsed.data });
        toast.success(t('integrations.saved', { name }));
      } else {
        const parsed = createIntegrationSchema.safeParse({
          name,
          config,
          secrets: secretBody,
          isEnabled,
        });
        if (!parsed.success) {
          setErrors(normalizeErrors(zodFieldErrors(parsed.error)));
          return;
        }
        setErrors({});
        const saved = await connect.mutateAsync(parsed.data);
        if (saved.status === 'error') {
          toast.error(t('integrations.wasSavedButTheConnection', { name: saved.name }));
        } else {
          toast.success(t('integrations.connected2', { name: saved.name }));
        }
      }
      onClose();
    } catch (error) {
      const fields = normalizeErrors(serverFieldErrors(error));
      if (Object.keys(fields).length) setErrors(fields);
      else setFormError(getErrorMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={submit} noValidate autoComplete="off" className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('common.edit2', { name: integration?.name })
                : t('integrations.connect3', { value: KIND_TITLES[kind] })}
            </DialogTitle>
            <DialogDescription>
              {t('integrations.credentialsAreEncryptedAndWrite')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-2">
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <FormField id="integration-name" label={t('common.name')} required error={errors.name}>
              <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField
              id="integration-base-url"
              label={t('common.baseUrl')}
              required
              error={errors.baseUrl}
              description={kind === 'n8n' ? t('integrations.whereYourN8nInstanceIs') : undefined}
            >
              <Input
                type="url"
                value={baseUrl}
                placeholder={t('integrations.httpsApiExampleCom')}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </FormField>

            {kind === 'n8n' ? (
              <FormField
                id="integration-webhook-prefix"
                label={t('integrations.webhookPathPrefix')}
                description={t('integrations.prependedToWebhookPathsUsed')}
                error={errors.webhookPathPrefix}
              >
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              </FormField>
            ) : (
              <>
                <FormField id="integration-auth-type" label={t('integrations.authentication')}>
                  <NativeSelect
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value as AuthType)}
                  >
                    <option value="none">{t('common.none')}</option>
                    <option value="bearer">{t('integrations.bearerToken')}</option>
                    <option value="basic">{t('integrations.basicUsernameAndPassword')}</option>
                    <option value="header">{t('integrations.customHeader')}</option>
                  </NativeSelect>
                </FormField>
                {authType === 'header' ? (
                  <FormField
                    id="integration-auth-header"
                    label={t('integrations.headerName')}
                    error={errors.authHeaderName}
                    description={t('integrations.forExampleXApiKey')}
                  >
                    <Input
                      value={authHeaderName}
                      onChange={(e) => setAuthHeaderName(e.target.value)}
                    />
                  </FormField>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <Label>{t('integrations.staticHeaders')}</Label>
                  <p className="text-xs text-fg-muted">
                    {t('integrations.sentWithEveryRequestDon')}
                  </p>
                  <KeyValueEditor
                    idPrefix="integration-headers"
                    label={t('common.header')}
                    value={headers}
                    onChange={setHeaders}
                  />
                </div>
              </>
            )}

            {secretFields.length > 0 ? (
              <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
                <legend className="px-1 text-sm font-medium">
                  {t('integrations.credentialsWriteOnly')}
                </legend>
                {secretFields.map(({ key, label }) => {
                  const isSet = stored.has(key);
                  const willClear = cleared.has(key);
                  return (
                    <div key={key} className="flex flex-col gap-1.5">
                      <FormField
                        id={`integration-secret-${key}`}
                        label={label}
                        error={errors[`secret.${key}`]}
                        description={
                          isSet
                            ? willClear
                              ? t('integrations.theStoredValueWillBe')
                              : t('integrations.aValueIsStoredLeave')
                            : undefined
                        }
                      >
                        <Input
                          type={
                            reveal && key !== 'username'
                              ? 'text'
                              : key === 'username'
                                ? 'text'
                                : 'password'
                          }
                          autoComplete="new-password"
                          spellCheck={false}
                          value={secrets[key] ?? ''}
                          disabled={willClear}
                          placeholder={isSet ? '••••••••' : ''}
                          onChange={(e) => setSecrets((s) => ({ ...s, [key]: e.target.value }))}
                        />
                      </FormField>
                      {isSet ? (
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`integration-clear-${key}`}
                            checked={willClear}
                            onCheckedChange={(checked) =>
                              setCleared((set) => {
                                const next = new Set(set);
                                if (checked) next.add(key);
                                else next.delete(key);
                                return next;
                              })
                            }
                          />
                          <Label htmlFor={`integration-clear-${key}`} className="font-normal">
                            {t('integrations.removeTheStored', {
                              name: label.toLowerCase(),
                            })}
                          </Label>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leadingIcon={reveal ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                    onClick={() => setReveal((v) => !v)}
                  >
                    {reveal ? t('integrations.hideWhatIType') : t('integrations.showWhatIType')}
                  </Button>
                </div>
              </fieldset>
            ) : null}

            <FormField id="integration-enabled" inline label={t('common.enabled')}>
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={connect.isPending || update.isPending}>
              {editing ? t('common.saveChanges') : t('integrations.connect')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
