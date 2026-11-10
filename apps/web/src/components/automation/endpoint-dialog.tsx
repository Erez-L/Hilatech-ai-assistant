'use client';

import * as React from 'react';
import {
  createWebhookEndpointSchema,
  type WebhookEndpoint,
  type WebhookEndpointWithSecret,
} from '@hilatech/contracts';
import {
  Alert,
  Button,
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
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import {
  useCreateWebhookEndpoint,
  useUpdateWebhookEndpoint,
  useWorkflows,
} from '@/hooks/automation';
import { serverFieldErrors, zodFieldErrors } from '@/lib/forms/zod-errors';
import { useT } from '@/i18n/provider';

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function EndpointDialog({
  endpoint,
  onClose,
  onCreated,
}: {
  endpoint?: WebhookEndpoint;
  onClose: () => void;
  onCreated?: (created: WebhookEndpointWithSecret) => void;
}) {
  const t = useT();
  const create = useCreateWebhookEndpoint();
  const update = useUpdateWebhookEndpoint();
  const workflows = useWorkflows({ pageSize: 100, triggerType: 'webhook' });
  const [name, setName] = React.useState(endpoint?.name ?? '');
  const [slug, setSlug] = React.useState(endpoint?.slug ?? '');
  const [slugTouched, setSlugTouched] = React.useState(!!endpoint);
  const [workflowId, setWorkflowId] = React.useState(endpoint?.workflowId ?? '');
  const [isEnabled, setIsEnabled] = React.useState(endpoint?.isEnabled ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      if (endpoint) {
        if (!name.trim()) {
          setErrors({ name: 'Enter a name' });
          return;
        }
        setErrors({});
        await update.mutateAsync({
          id: endpoint.id,
          body: { name: name.trim(), workflowId: workflowId || undefined, isEnabled },
        });
        toast.success(t('automation.endpointSaved'));
        onClose();
        return;
      }
      const parsed = createWebhookEndpointSchema.safeParse({
        name,
        slug,
        workflowId: workflowId || undefined,
        isEnabled,
      });
      if (!parsed.success) {
        const found = zodFieldErrors(parsed.error);
        setErrors({
          ...(found.name ? { name: 'Enter a name' } : {}),
          ...(found.slug
            ? {
                slug: 'Use 3–64 lowercase letters, digits and dashes, starting with a letter or digit',
              }
            : {}),
        });
        return;
      }
      setErrors({});
      const created = await create.mutateAsync(parsed.data);
      onCreated?.(created);
      onClose();
    } catch (error) {
      const fields = serverFieldErrors(error);
      if (Object.keys(fields).length) setErrors(fields);
      else setFormError(getErrorMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>
              {endpoint ? t('automation.editInboundEndpoint') : t('automation.newInboundEndpoint')}
            </DialogTitle>
            <DialogDescription>{t('automation.externalSystemsPostToThis')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-2">
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <FormField id="endpoint-name" label={t('common.name')} required error={errors.name}>
              <Input
                value={name}
                maxLength={120}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            </FormField>
            <FormField
              id="endpoint-slug"
              label={t('automation.slug')}
              required
              description={
                endpoint ? t('automation.theSlugIsPartOf') : t('automation.becomesPartOfTheUrl')
              }
              error={errors.slug}
            >
              <Input
                className="font-mono"
                value={slug}
                disabled={!!endpoint}
                maxLength={64}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
            </FormField>
            <FormField
              id="endpoint-workflow"
              label={t('automation.workflowToRun')}
              description={t('automation.onlyWorkflowsWithTheInbound')}
              error={errors.workflowId}
            >
              <NativeSelect value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
                <option value="">{t('automation.noneYet')}</option>
                {(workflows.data?.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="endpoint-enabled" inline label={t('common.enabled')}>
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {endpoint ? t('common.saveChanges') : t('automation.createEndpoint')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
