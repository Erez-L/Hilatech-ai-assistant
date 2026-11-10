'use client';

import * as React from 'react';
import {
  createWebhookSchema,
  type DomainEvent,
  type Webhook,
  type WebhookWithSecret,
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
  Switch,
  Textarea,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useCreateWebhook, useUpdateWebhook } from '@/hooks/automation';
import { serverFieldErrors, zodFieldErrors } from '@/lib/forms/zod-errors';
import { EventPicker } from './event-picker';
import { useT } from '@/i18n/provider';

export function WebhookDialog({
  webhook,
  onClose,
  onCreated,
}: {
  /** Existing subscription to edit; omit to create. */
  webhook?: Webhook;
  onClose: () => void;
  /** Called with the new subscription including its one-time secret. */
  onCreated?: (created: WebhookWithSecret) => void;
}) {
  const t = useT();
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const [url, setUrl] = React.useState(webhook?.url ?? '');
  const [description, setDescription] = React.useState(webhook?.description ?? '');
  const [events, setEvents] = React.useState<DomainEvent[]>(webhook?.events ?? []);
  const [isEnabled, setIsEnabled] = React.useState(webhook?.isEnabled ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = createWebhookSchema.safeParse({
      url,
      description: description.trim() || undefined,
      events,
      isEnabled,
    });
    if (!parsed.success) {
      const found = zodFieldErrors(parsed.error);
      setErrors({
        ...(found.url
          ? { url: 'Enter a valid https:// URL (http is allowed only for localhost)' }
          : {}),
        ...(found.events ? { events: 'Choose at least one event' } : {}),
        ...(found.description ? { description: found.description } : {}),
      });
      return;
    }
    setErrors({});
    try {
      if (webhook) {
        await update.mutateAsync({ id: webhook.id, body: parsed.data });
        toast.success(t('automation.webhookSaved'));
        onClose();
      } else {
        const created = await create.mutateAsync(parsed.data);
        onCreated?.(created);
        onClose();
      }
    } catch (error) {
      const fields = serverFieldErrors(error);
      if (Object.keys(fields).length) setErrors(fields);
      else setFormError(getErrorMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>
              {webhook ? t('automation.editWebhook2') : t('automation.newOutboundWebhook')}
            </DialogTitle>
            <DialogDescription>{t('automation.wePostASignedJson')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-2">
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <FormField
              id="webhook-url"
              label={t('automation.endpointUrl')}
              required
              error={errors.url}
            >
              <Input
                type="url"
                value={url}
                placeholder={t('automation.httpsExampleComHooksHilatech')}
                onChange={(e) => setUrl(e.target.value)}
              />
            </FormField>
            <FormField
              id="webhook-description"
              label={t('common.description')}
              error={errors.description}
            >
              <Textarea
                rows={2}
                value={description}
                maxLength={500}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
            <EventPicker
              idPrefix="webhook-event"
              value={events}
              onChange={setEvents}
              error={errors.events}
            />
            <FormField id="webhook-enabled" inline label={t('common.enabled')}>
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {webhook ? t('common.saveChanges') : t('automation.createWebhook')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
