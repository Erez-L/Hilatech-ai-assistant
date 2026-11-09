'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Permission, type ContactSummary, type LeadWithRelations } from '@hilatech/contracts';
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
import { useCreateLead } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { applyServerErrors } from '@/lib/forms/server-errors';
import {
  LEAD_FORM_FIELDS,
  LeadFormFields,
  leadFormDefaults,
  leadFormSchema,
  toCreateLeadRequest,
  type LeadFormInput,
  type LeadFormValues,
} from './lead-form';

export interface LeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-link the new lead to a contact (from the contact detail page). */
  contact?: ContactSummary | null;
  onCreated?: (lead: LeadWithRelations) => void;
}

export function LeadDialog({ open, onOpenChange, contact, onCreated }: LeadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {/* Mounted with the dialog so every opening starts from a clean form. */}
        <LeadCreateForm
          contact={contact ?? null}
          onDone={(lead) => {
            onOpenChange(false);
            if (lead) onCreated?.(lead);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function LeadCreateForm({
  contact,
  onDone,
}: {
  contact: ContactSummary | null;
  onDone: (lead?: LeadWithRelations) => void;
}) {
  const create = useCreateLead();
  const canAssign = useCan(Permission.LEADS_ASSIGN);
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<LeadFormInput, unknown, LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: leadFormDefaults(null, { contactId: contact?.id ?? '' }),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const lead = await create.mutateAsync(toCreateLeadRequest(values));
      toast.success(`Lead “${lead.title}” created`);
      onDone(lead);
    } catch (error) {
      if (!applyServerErrors(error, form.setError, LEAD_FORM_FIELDS))
        setFormError(getErrorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>New lead</DialogTitle>
        <DialogDescription>
          Capture the opportunity now; you can refine details, notes and ownership later.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <LeadFormFields
          form={form}
          withStatus
          withAssignee={canAssign}
          selectedContact={contact}
          autoFocusTitle
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Create lead
        </Button>
      </DialogFooter>
    </form>
  );
}
