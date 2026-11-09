'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Permission, type Contact } from '@hilatech/contracts';
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
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useCreateContact } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { contactName } from '@/lib/crm';
import {
  CONTACT_FORM_FIELDS,
  ContactFormFields,
  contactFormDefaults,
  contactFormSchema,
  toCreateContactRequest,
  type ContactFormInput,
  type ContactFormValues,
} from './contact-form';

export interface ContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (contact: Contact) => void;
}

export function ContactDialog({ open, onOpenChange, onCreated }: ContactDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <ContactCreateForm
          onDone={(contact) => {
            onOpenChange(false);
            if (contact) onCreated?.(contact);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ContactCreateForm({ onDone }: { onDone: (contact?: Contact) => void }) {
  const create = useCreateContact();
  const canReadMembers = useCan(Permission.MEMBERS_READ);
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<ContactFormInput, unknown, ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: contactFormDefaults(),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const contact = await create.mutateAsync(toCreateContactRequest(values));
      toast.success(`${contactName(contact)} added to contacts`);
      onDone(contact);
    } catch (error) {
      if (!applyServerErrors(error, form.setError, CONTACT_FORM_FIELDS))
        setFormError(getErrorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>New contact</DialogTitle>
        <DialogDescription>A person or company your business talks to.</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <ContactFormFields form={form} withOwner={canReadMembers} autoFocusName />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Create contact
        </Button>
      </DialogFooter>
    </form>
  );
}
