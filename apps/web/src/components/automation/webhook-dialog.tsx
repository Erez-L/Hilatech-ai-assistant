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
        toast.success('Webhook saved');
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
            <DialogTitle>{webhook ? 'Edit webhook' : 'New outbound webhook'}</DialogTitle>
            <DialogDescription>
              We POST a signed JSON payload to this URL whenever one of the chosen events happens.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-2">
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <FormField id="webhook-url" label="Endpoint URL" required error={errors.url}>
              <Input
                type="url"
                value={url}
                placeholder="https://example.com/hooks/hilatech"
                onChange={(e) => setUrl(e.target.value)}
              />
            </FormField>
            <FormField id="webhook-description" label="Description" error={errors.description}>
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
            <FormField id="webhook-enabled" inline label="Enabled">
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {webhook ? 'Save changes' : 'Create webhook'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
