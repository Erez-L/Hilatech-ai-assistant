'use client';
import { vm } from '@/i18n/validation';

import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  convertLeadSchema,
  type ConvertLeadRequest,
  type LeadWithRelations,
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
  cn,
} from '@hilatech/ui';
import { getErrorMessage, type ConvertLeadResponse } from '@/lib/api';
import { useConvertLead } from '@/hooks/queries';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { ContactPicker } from '@/components/crm/contact-picker';
import { useT } from '@/i18n/provider';

/**
 * Form model: a mode switch plus both branches. `toConvertRequest` builds the contract payload with
 * exactly one of `contactId` / `contact`, then `convertLeadSchema` verifies it.
 */
export const convertFormSchema = z
  .object({
    mode: z.enum(['existing', 'new']),
    contactId: z.string(),
    contact: z.object({
      firstName: z.string().trim().max(80, 'Keep it under 80 characters'),
      lastName: z.string().trim().max(80, 'Keep it under 80 characters'),
      email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email')]),
      phone: z.string().trim().max(32, 'Keep it under 32 characters'),
      company: z.string().trim().max(120, 'Keep it under 120 characters'),
    }),
    markWon: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'existing' && !v.contactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contactId'],
        message: vm('leads.selectAContactToLink'),
      });
    }
    if (v.mode === 'new' && !v.contact.firstName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contact', 'firstName'],
        message: vm('leads.enterAFirstName'),
      });
    }
  });
export type ConvertFormValues = z.infer<typeof convertFormSchema>;

export function toConvertRequest(values: ConvertFormValues): ConvertLeadRequest {
  const payload =
    values.mode === 'existing'
      ? { contactId: values.contactId, markWon: values.markWon }
      : {
          contact: {
            firstName: values.contact.firstName,
            lastName: values.contact.lastName || undefined,
            email: values.contact.email || undefined,
            phone: values.contact.phone || undefined,
            company: values.contact.company || undefined,
          },
          markWon: values.markWon,
        };
  return convertLeadSchema.parse(payload);
}

/** Seed the "new contact" branch from the lead title when it looks like a person or company name. */
function guessContact(lead: LeadWithRelations): ConvertFormValues['contact'] {
  return {
    firstName: lead.contact?.firstName ?? '',
    lastName: lead.contact?.lastName ?? '',
    email: lead.contact?.email ?? '',
    phone: lead.contact?.phone ?? '',
    company: lead.contact?.company ?? '',
  };
}

export interface ConvertLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadWithRelations;
  onConverted?: (result: ConvertLeadResponse) => void;
}

export function ConvertLeadDialog({
  open,
  onOpenChange,
  lead,
  onConverted,
}: ConvertLeadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <ConvertForm
          lead={lead}
          onDone={(result) => {
            onOpenChange(false);
            if (result) onConverted?.(result);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConvertForm({
  lead,
  onDone,
}: {
  lead: LeadWithRelations;
  onDone: (result?: ConvertLeadResponse) => void;
}) {
  const t = useT();
  const convert = useConvertLead();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [selectedContact, setSelectedContact] = React.useState(lead.contact);

  const form = useForm<ConvertFormValues>({
    resolver: zodResolver(convertFormSchema),
    defaultValues: {
      mode: lead.contactId ? 'existing' : 'new',
      contactId: lead.contactId ?? '',
      contact: guessContact(lead),
      markWon: false,
    },
  });
  const mode = useWatch({ control: form.control, name: 'mode' });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await convert.mutateAsync({ id: lead.id, body: toConvertRequest(values) });
      onDone(result);
    } catch (error) {
      if (
        !applyServerErrors(error, form.setError, [
          'contactId',
          'contact.firstName',
          'contact.lastName',
          'contact.email',
          'contact.phone',
          'contact.company',
          'markWon',
        ])
      ) {
        setFormError(getErrorMessage(error));
      }
    }
  });

  const modes: { value: ConvertFormValues['mode']; label: string; hint: string }[] = [
    {
      value: 'existing',
      label: t('leads.linkAnExistingContact'),
      hint: t('leads.attachThisLeadToSomeone'),
    },
    {
      value: 'new',
      label: t('leads.createANewContact'),
      hint: t('leads.addThePersonOrCompany'),
    },
  ];

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>{t('leads.convertLead')}</DialogTitle>
        <DialogDescription>
          {t('leads.turnIntoAContactRelationship', { title: lead.title })}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        <Controller
          control={form.control}
          name="mode"
          render={({ field }) => (
            <div
              role="radiogroup"
              aria-label={t('common.contact')}
              className="grid gap-2 sm:grid-cols-2"
            >
              {modes.map((m) => {
                const active = field.value === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      field.onChange(m.value);
                      form.clearErrors();
                    }}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-md border px-4 py-3 text-start text-sm transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      active
                        ? 'border-accent bg-accent-soft text-accent-soft-fg'
                        : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
                    )}
                  >
                    <span className="font-medium">{m.label}</span>
                    <span className={cn('text-xs', active ? 'opacity-80' : 'text-fg-subtle')}>
                      {m.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        />

        {mode === 'existing' ? (
          <FormField
            id="convert-contact"
            label={t('common.contact')}
            error={form.formState.errors.contactId?.message}
            required
          >
            <Controller
              control={form.control}
              name="contactId"
              render={({ field, fieldState }) => (
                <ContactPicker
                  id="convert-contact"
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
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="convert-first-name"
                label={t('common.firstName')}
                error={form.formState.errors.contact?.firstName?.message}
                required
              >
                <Input autoComplete="off" {...form.register('contact.firstName')} />
              </FormField>
              <FormField
                id="convert-last-name"
                label={t('common.lastName')}
                error={form.formState.errors.contact?.lastName?.message}
              >
                <Input autoComplete="off" {...form.register('contact.lastName')} />
              </FormField>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="convert-email"
                label={t('common.email')}
                error={form.formState.errors.contact?.email?.message}
              >
                <Input type="email" autoComplete="off" {...form.register('contact.email')} />
              </FormField>
              <FormField
                id="convert-phone"
                label={t('common.phone')}
                error={form.formState.errors.contact?.phone?.message}
              >
                <Input type="tel" autoComplete="off" {...form.register('contact.phone')} />
              </FormField>
            </div>
            <FormField
              id="convert-company"
              label={t('common.company')}
              error={form.formState.errors.contact?.company?.message}
            >
              <Input autoComplete="off" {...form.register('contact.company')} />
            </FormField>
          </div>
        )}

        <Controller
          control={form.control}
          name="markWon"
          render={({ field }) => (
            <div className="flex items-start gap-2.5 rounded-md border border-border px-4 py-3">
              <Checkbox
                id="convert-mark-won"
                className="mt-0.5"
                checked={field.value}
                onCheckedChange={(c) => field.onChange(c === true)}
                disabled={lead.status === 'won'}
              />
              <Label htmlFor="convert-mark-won" className="flex flex-col gap-0.5 font-normal">
                <span className="text-sm font-medium">{t('leads.markAsWon')}</span>
                <span className="text-xs text-fg-muted">
                  {lead.status === 'won'
                    ? t('leads.thisLeadIsAlreadyWon')
                    : t('leads.closesTheLeadAsWon')}
                </span>
              </Label>
            </div>
          )}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('leads.convertLead')}
        </Button>
      </DialogFooter>
    </form>
  );
}
