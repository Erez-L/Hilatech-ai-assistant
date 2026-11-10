'use client';

import * as React from 'react';
import type { ConversationWithRelations } from '@hilatech/contracts';
import {
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
  toast,
} from '@hilatech/ui';
import { useUpdateConversation } from '@/hooks/queries';
import { ContactPicker } from '@/components/crm/contact-picker';
import { LeadPicker } from '@/components/crm/lead-picker';
import { useT } from '@/i18n/provider';

/** Edit the subject and the contact/lead a conversation is linked to (PATCH /conversations/:id). */
export function LinkRecordsDialog({
  open,
  onOpenChange,
  conversation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationWithRelations;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <LinkForm conversation={conversation} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({
  conversation,
  onDone,
}: {
  conversation: ConversationWithRelations;
  onDone: () => void;
}) {
  const t = useT();
  const update = useUpdateConversation();
  const [subject, setSubject] = React.useState(conversation.subject ?? '');
  const [contactId, setContactId] = React.useState<string | null>(conversation.contactId);
  const [contact, setContact] = React.useState(conversation.contact);
  const [leadId, setLeadId] = React.useState<string | null>(conversation.leadId);
  const [leadTitle, setLeadTitle] = React.useState(conversation.lead?.title);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    update.mutate(
      {
        id: conversation.id,
        body: {
          subject: subject.trim() || undefined,
          contactId: contactId ?? null,
          leadId: leadId ?? null,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('conversations.conversationUpdated'));
          onDone();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>{t('conversations.conversationDetails')}</DialogTitle>
        <DialogDescription>{t('conversations.linkThisThreadToThe')}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        <FormField id="link-subject" label={t('common.subject')}>
          <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        </FormField>
        <FormField id="link-contact" label={t('common.contact')}>
          <ContactPicker
            value={contactId}
            selected={contact}
            onValueChange={(next, summary) => {
              setContactId(next);
              setContact(summary);
            }}
          />
        </FormField>
        <FormField id="link-lead" label={t('common.lead')}>
          <LeadPicker
            value={leadId}
            selectedLabel={leadTitle}
            contactId={contactId ?? undefined}
            onValueChange={(next, found) => {
              setLeadId(next);
              setLeadTitle(found?.title);
            }}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={update.isPending}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
