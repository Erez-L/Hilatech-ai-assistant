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
      ? [{ key: 'apiKey', label: 'API key (optional)' }]
      : authType === 'bearer'
        ? [{ key: 'accessToken', label: 'Bearer token' }]
        : authType === 'basic'
          ? [
              { key: 'username', label: 'Username' },
              { key: 'password', label: 'Password' },
            ]
          : authType === 'header'
            ? [{ key: 'apiKey', label: 'Header value' }]
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
        toast.success(`${name} saved`);
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
          toast.error(`${saved.name} was saved but the connection test failed`);
        } else {
          toast.success(`${saved.name} connected`);
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
              {editing ? `Edit ${integration?.name}` : `Connect ${KIND_TITLES[kind]}`}
            </DialogTitle>
            <DialogDescription>
              Credentials are encrypted and write-only: once saved they can’t be displayed again,
              only replaced or removed.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-2">
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <FormField id="integration-name" label="Name" required error={errors.name}>
              <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField
              id="integration-base-url"
              label="Base URL"
              required
              error={errors.baseUrl}
              description={
                kind === 'n8n'
                  ? 'Where your n8n instance is reachable, e.g. https://n8n.example.com'
                  : undefined
              }
            >
              <Input
                type="url"
                value={baseUrl}
                placeholder="https://api.example.com"
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </FormField>

            {kind === 'n8n' ? (
              <FormField
                id="integration-webhook-prefix"
                label="Webhook path prefix"
                description="Prepended to webhook paths used by n8n steps."
                error={errors.webhookPathPrefix}
              >
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              </FormField>
            ) : (
              <>
                <FormField id="integration-auth-type" label="Authentication">
                  <NativeSelect
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value as AuthType)}
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer token</option>
                    <option value="basic">Basic (username and password)</option>
                    <option value="header">Custom header</option>
                  </NativeSelect>
                </FormField>
                {authType === 'header' ? (
                  <FormField
                    id="integration-auth-header"
                    label="Header name"
                    error={errors.authHeaderName}
                    description="For example X-API-Key."
                  >
                    <Input
                      value={authHeaderName}
                      onChange={(e) => setAuthHeaderName(e.target.value)}
                    />
                  </FormField>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <Label>Static headers</Label>
                  <p className="text-xs text-fg-muted">
                    Sent with every request. Don’t put secrets here — use the credential fields.
                  </p>
                  <KeyValueEditor
                    idPrefix="integration-headers"
                    label="Header"
                    value={headers}
                    onChange={setHeaders}
                  />
                </div>
              </>
            )}

            {secretFields.length > 0 ? (
              <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
                <legend className="px-1 text-sm font-medium">Credentials (write-only)</legend>
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
                              ? 'The stored value will be removed when you save.'
                              : 'A value is stored. Leave blank to keep it, or type a new one to replace it.'
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
                            Remove the stored {label.toLowerCase()}
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
                    {reveal ? 'Hide what I type' : 'Show what I type'}
                  </Button>
                </div>
              </fieldset>
            ) : null}

            <FormField id="integration-enabled" inline label="Enabled">
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={connect.isPending || update.isPending}>
              {editing ? 'Save changes' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
