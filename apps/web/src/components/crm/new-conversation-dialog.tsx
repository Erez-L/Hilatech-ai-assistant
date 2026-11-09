'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ConversationChannel,
  createConversationSchema,
  type ContactSummary,
  type ConversationWithRelations,
  type CreateConversationRequest,
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
  Textarea,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useCreateConversation } from '@/hooks/queries';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { CONVERSATION_CHANNELS, CONVERSATION_CHANNEL_LABELS } from '@/lib/crm';
import { ContactPicker } from './contact-picker';
import { LeadPicker } from './lead-picker';

export const newConversationFormSchema = z.object({
  subject: z.string().trim().max(200, 'Keep the subject under 200 characters'),
  channel: ConversationChannel,
  contactId: z.string(),
  leadId: z.string(),
  initialMessage: z.string().trim().max(20000, 'Keep the message under 20,000 characters'),
});
export type NewConversationFormValues = z.infer<typeof newConversationFormSchema>;

export function toCreateConversationRequest(
  values: NewConversationFormValues,
): CreateConversationRequest {
  return createConversationSchema.parse({
    subject: values.subject || undefined,
    channel: values.channel,
    contactId: values.contactId || undefined,
    leadId: values.leadId || undefined,
    initialMessage: values.initialMessage || undefined,
  });
}

export interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-linked records (from a lead or contact page). */
  contact?: ContactSummary | null;
  lead?: { id: string; title: string } | null;
  onCreated?: (conversation: ConversationWithRelations) => void;
}

export function NewConversationDialog({
  open,
  onOpenChange,
  contact,
  lead,
  onCreated,
}: NewConversationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <NewConversationForm
          contact={contact ?? null}
          lead={lead ?? null}
          onDone={(conversation) => {
            onOpenChange(false);
            if (conversation) onCreated?.(conversation);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewConversationForm({
  contact,
  lead,
  onDone,
}: {
  contact: ContactSummary | null;
  lead: { id: string; title: string } | null;
  onDone: (conversation?: ConversationWithRelations) => void;
}) {
  const create = useCreateConversation();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [selectedContact, setSelectedContact] = React.useState(contact);
  const [selectedLeadTitle, setSelectedLeadTitle] = React.useState(lead?.title);

  const form = useForm<NewConversationFormValues>({
    resolver: zodResolver(newConversationFormSchema),
    defaultValues: {
      subject: lead?.title ?? '',
      channel: 'internal',
      contactId: contact?.id ?? '',
      leadId: lead?.id ?? '',
      initialMessage: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const conversation = await create.mutateAsync(toCreateConversationRequest(values));
      toast.success('Conversation started');
      onDone(conversation);
    } catch (error) {
      if (
        !applyServerErrors(error, form.setError, [
          'subject',
          'channel',
          'contactId',
          'leadId',
          'initialMessage',
        ])
      ) {
        setFormError(getErrorMessage(error));
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>New conversation</DialogTitle>
        <DialogDescription>
          Open a thread with a customer or log one that happened elsewhere.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-5 sm:grid-cols-[1fr_11rem]">
          <FormField
            id="conv-subject"
            label="Subject"
            error={form.formState.errors.subject?.message}
          >
            <Input
              autoFocus
              placeholder="Quote for the spring campaign"
              {...form.register('subject')}
            />
          </FormField>
          <FormField
            id="conv-channel"
            label="Channel"
            error={form.formState.errors.channel?.message}
          >
            <NativeSelect {...form.register('channel')}>
              {CONVERSATION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CONVERSATION_CHANNEL_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="conv-contact"
            label="Contact"
            error={form.formState.errors.contactId?.message}
          >
            <Controller
              control={form.control}
              name="contactId"
              render={({ field, fieldState }) => (
                <ContactPicker
                  id="conv-contact"
                  aria-invalid={fieldState.error ? true : undefined}
                  value={field.value || null}
                  selected={selectedContact}
                  onValueChange={(next, summary) => {
                    field.onChange(next ?? '');
                    setSelectedContact(summary);
                  }}
                />
              )}
            />
          </FormField>
          <FormField id="conv-lead" label="Lead" error={form.formState.errors.leadId?.message}>
            <Controller
              control={form.control}
              name="leadId"
              render={({ field, fieldState }) => (
                <LeadPicker
                  id="conv-lead"
                  aria-invalid={fieldState.error ? true : undefined}
                  value={field.value || null}
                  selectedLabel={selectedLeadTitle}
                  onValueChange={(next, found) => {
                    field.onChange(next ?? '');
                    setSelectedLeadTitle(found?.title);
                  }}
                />
              )}
            />
          </FormField>
        </div>
        <FormField
          id="conv-message"
          label="First message"
          description="Sent as the team’s opening message. Optional."
          error={form.formState.errors.initialMessage?.message}
        >
          <Textarea
            rows={3}
            placeholder="Hi! Thanks for reaching out…"
            {...form.register('initialMessage')}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Start conversation
        </Button>
      </DialogFooter>
    </form>
  );
}
