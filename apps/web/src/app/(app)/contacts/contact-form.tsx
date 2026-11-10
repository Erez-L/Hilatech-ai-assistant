'use client';

import * as React from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import {
  createContactSchema,
  type Contact,
  type CreateContactRequest,
  type UpdateContactRequest,
} from '@hilatech/contracts';
import { FormField, Input, TagInput, Textarea } from '@hilatech/ui';
import { useContactTags } from '@/hooks/queries';
import { AssigneePicker } from '@/components/crm/assignee-picker';
import { useT } from '@/i18n/provider';

/** Contract rules with browser-friendly inputs ('' for empty optional strings). */
export const contactFormSchema = createContactSchema
  .omit({ firstName: true, email: true, customFields: true, ownerId: true })
  .extend({
    firstName: z
      .string()
      .trim()
      .min(1, 'Enter a first name')
      .max(80, 'Keep it under 80 characters'),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email')]),
    ownerId: z.string(),
  });
export type ContactFormInput = z.input<typeof contactFormSchema>;
export type ContactFormValues = z.output<typeof contactFormSchema>;

export function contactFormDefaults(
  contact?: Contact | null,
  overrides: Partial<ContactFormInput> = {},
): ContactFormInput {
  return {
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    company: contact?.company ?? '',
    jobTitle: contact?.jobTitle ?? '',
    tags: contact?.tags ?? [],
    notes: contact?.notes ?? '',
    ownerId: contact?.ownerId ?? '',
    ...overrides,
  };
}

export function toCreateContactRequest(values: ContactFormValues): CreateContactRequest {
  return createContactSchema.parse({
    firstName: values.firstName,
    lastName: values.lastName || undefined,
    email: values.email || undefined,
    phone: values.phone || undefined,
    company: values.company || undefined,
    jobTitle: values.jobTitle || undefined,
    tags: values.tags,
    notes: values.notes || undefined,
    customFields: {},
    ownerId: values.ownerId || undefined,
  });
}

/** PATCH body. Empty strings are sent so cleared fields clear on the server (nullable in storage). */
export function toUpdateContactRequest(values: ContactFormValues): UpdateContactRequest {
  return {
    firstName: values.firstName,
    lastName: values.lastName ?? '',
    email: values.email || undefined,
    phone: values.phone ?? '',
    company: values.company ?? '',
    jobTitle: values.jobTitle ?? '',
    tags: values.tags,
    notes: values.notes ?? '',
    ownerId: values.ownerId || undefined,
  };
}

export const CONTACT_FORM_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'company',
  'jobTitle',
  'tags',
  'notes',
  'ownerId',
] as const;

export function ContactFormFields({
  form,
  withOwner,
  idPrefix = 'contact',
  autoFocusName = false,
  disabled = false,
}: {
  form: UseFormReturn<ContactFormInput, unknown, ContactFormValues>;
  withOwner: boolean;
  idPrefix?: string;
  autoFocusName?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const errors = form.formState.errors;
  const tags = useContactTags();
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id={id('firstName')}
          label={t('common.firstName')}
          error={errors.firstName?.message}
          required
        >
          <Input autoFocus={autoFocusName} autoComplete="off" {...form.register('firstName')} />
        </FormField>
        <FormField
          id={id('lastName')}
          label={t('common.lastName')}
          error={errors.lastName?.message}
        >
          <Input autoComplete="off" {...form.register('lastName')} />
        </FormField>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id={id('email')} label={t('common.email')} error={errors.email?.message}>
          <Input type="email" inputMode="email" autoComplete="off" {...form.register('email')} />
        </FormField>
        <FormField id={id('phone')} label={t('common.phone')} error={errors.phone?.message}>
          <Input type="tel" inputMode="tel" autoComplete="off" {...form.register('phone')} />
        </FormField>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id={id('company')} label={t('common.company')} error={errors.company?.message}>
          <Input autoComplete="organization" {...form.register('company')} />
        </FormField>
        <FormField
          id={id('jobTitle')}
          label={t('contacts.jobTitle')}
          error={errors.jobTitle?.message}
        >
          <Input autoComplete="organization-title" {...form.register('jobTitle')} />
        </FormField>
      </div>
      <div className={withOwner ? 'grid gap-5 sm:grid-cols-2' : 'grid gap-5'}>
        <FormField
          id={id('tags')}
          label={t('common.tags')}
          description={t('common.pressEnterOrCommaTo')}
          error={errors.tags?.message}
        >
          <Controller
            control={form.control}
            name="tags"
            render={({ field, fieldState }) => (
              <TagInput
                id={id('tags')}
                aria-invalid={fieldState.error ? true : undefined}
                value={field.value ?? []}
                onValueChange={field.onChange}
                suggestions={tags.data ?? []}
                maxTags={20}
                disabled={disabled}
              />
            )}
          />
        </FormField>
        {withOwner ? (
          <FormField
            id={id('ownerId')}
            label={t('contacts.owner')}
            description={t('contacts.theTeammateWhoHoldsThis')}
            error={errors.ownerId?.message}
          >
            <Controller
              control={form.control}
              name="ownerId"
              render={({ field, fieldState }) => (
                <AssigneePicker
                  id={id('ownerId')}
                  aria-invalid={fieldState.error ? true : undefined}
                  value={field.value || null}
                  onValueChange={(next) => field.onChange(next ?? '')}
                  emptyLabel={t('contacts.noOwner')}
                  disabled={disabled}
                />
              )}
            />
          </FormField>
        ) : null}
      </div>
      <FormField id={id('notes')} label={t('common.notes')} error={errors.notes?.message}>
        <Textarea
          rows={3}
          placeholder={t('contacts.preferencesHistoryAnythingTheTeam')}
          {...form.register('notes')}
        />
      </FormField>
    </fieldset>
  );
}
