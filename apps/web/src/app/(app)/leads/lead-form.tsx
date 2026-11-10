'use client';
import { vm } from '@/i18n/validation';

import * as React from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import {
  createLeadSchema,
  type CreateLeadRequest,
  type LeadWithRelations,
  type UpdateLeadRequest,
} from '@hilatech/contracts';
import { FormField, Input, NativeSelect, TagInput, Textarea } from '@hilatech/ui';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STATUSES, LEAD_STATUS_LABELS } from '@/lib/crm';
import { ContactPicker } from '@/components/crm/contact-picker';
import { AssigneePicker } from '@/components/crm/assignee-picker';
import { useT } from '@/i18n/provider';

/**
 * Form-side schema: the contract rules for every field, with the inputs the browser produces
 * (strings for money/dates, '' for "none") accepted and mapped in `toLeadRequest`.
 */
export const leadFormSchema = createLeadSchema
  .omit({
    title: true,
    value: true,
    expectedCloseDate: true,
    contactId: true,
    assigneeId: true,
    customFields: true,
  })
  .extend({
    title: z
      .string()
      .trim()
      .min(1, 'Enter a title')
      .max(160, 'Keep the title under 160 characters'),
    value: z
      .string()
      .trim()
      .transform((raw, ctx): number | '' => {
        if (raw === '') return '';
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: vm('leads.enterAValidAmount') });
          return z.NEVER;
        }
        if (n < 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: vm('leads.valueCannotBeNegative'),
          });
          return z.NEVER;
        }
        return n;
      }),
    expectedCloseDate: z.union([
      z.literal(''),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
    ]),
    contactId: z.string(),
    assigneeId: z.string(),
  });
export type LeadFormInput = z.input<typeof leadFormSchema>;
export type LeadFormValues = z.output<typeof leadFormSchema>;

export function leadFormDefaults(
  lead?: LeadWithRelations | null,
  overrides: Partial<LeadFormInput> = {},
): LeadFormInput {
  return {
    title: lead?.title ?? '',
    status: lead?.status ?? 'new',
    source: lead?.source ?? 'other',
    value: lead?.value == null ? '' : String(lead.value),
    currency: lead?.currency ?? 'USD',
    contactId: lead?.contactId ?? '',
    assigneeId: lead?.assigneeId ?? '',
    description: lead?.description ?? '',
    tags: lead?.tags ?? [],
    expectedCloseDate: lead?.expectedCloseDate ? lead.expectedCloseDate.slice(0, 10) : '',
    ...overrides,
  };
}

/** Local noon keeps the chosen calendar day stable across time zones once serialised to UTC. */
function dateToIso(day: string): string {
  return new Date(`${day}T12:00:00`).toISOString();
}

export function toCreateLeadRequest(values: LeadFormValues): CreateLeadRequest {
  return createLeadSchema.parse({
    title: values.title,
    status: values.status,
    source: values.source,
    value: values.value === '' ? undefined : values.value,
    currency: values.currency,
    contactId: values.contactId || undefined,
    assigneeId: values.assigneeId || undefined,
    description: values.description || undefined,
    tags: values.tags,
    customFields: {},
    expectedCloseDate: values.expectedCloseDate ? dateToIso(values.expectedCloseDate) : undefined,
  });
}

/** PATCH body: `status` is managed by the pipeline control, not the details form. */
export function toUpdateLeadRequest(values: LeadFormValues): UpdateLeadRequest {
  return {
    title: values.title,
    source: values.source,
    value: values.value === '' ? undefined : values.value,
    currency: values.currency,
    contactId: values.contactId || undefined,
    description: values.description ?? '',
    tags: values.tags,
    expectedCloseDate: values.expectedCloseDate ? dateToIso(values.expectedCloseDate) : undefined,
  };
}

export const LEAD_FORM_FIELDS = [
  'title',
  'status',
  'source',
  'value',
  'currency',
  'contactId',
  'assigneeId',
  'description',
  'tags',
  'expectedCloseDate',
] as const;

export interface LeadFormFieldsProps {
  form: UseFormReturn<LeadFormInput, unknown, LeadFormValues>;
  /** Show the status select (creation only; the detail page uses the pipeline control). */
  withStatus?: boolean;
  /** Show the assignee field (requires leads:assign). */
  withAssignee?: boolean;
  /** Known contact for the current contactId (so the picker can show its name before searching). */
  selectedContact?: LeadWithRelations['contact'];
  idPrefix?: string;
  autoFocusTitle?: boolean;
  disabled?: boolean;
}

export function LeadFormFields({
  form,
  withStatus = false,
  withAssignee = false,
  selectedContact,
  idPrefix = 'lead',
  autoFocusTitle = false,
  disabled = false,
}: LeadFormFieldsProps) {
  const t = useT();
  const errors = form.formState.errors;
  const [contact, setContact] = React.useState(selectedContact ?? null);
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-5">
      <FormField id={id('title')} label={t('common.title')} error={errors.title?.message} required>
        <Input
          autoFocus={autoFocusTitle}
          placeholder={t('leads.websiteRedesignForAcme')}
          {...form.register('title')}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        {withStatus ? (
          <FormField id={id('status')} label={t('common.stage')} error={errors.status?.message}>
            <NativeSelect {...form.register('status')}>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(LEAD_STATUS_LABELS[s])}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
        <FormField id={id('source')} label={t('common.source')} error={errors.source?.message}>
          <NativeSelect {...form.register('source')}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(LEAD_SOURCE_LABELS[s])}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          id={id('expectedCloseDate')}
          label={t('leads.expectedClose')}
          error={errors.expectedCloseDate?.message}
        >
          <Input type="date" {...form.register('expectedCloseDate')} />
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_7rem]">
        <FormField
          id={id('value')}
          label={t('common.value')}
          error={errors.value?.message}
          description={t('leads.estimatedDealValueLeaveEmpty')}
        >
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="0"
            className="tabular"
            {...form.register('value')}
          />
        </FormField>
        <FormField
          id={id('currency')}
          label={t('common.currency')}
          error={errors.currency?.message}
        >
          <Input
            maxLength={3}
            placeholder={t('leads.usd')}
            className="font-mono uppercase"
            autoCapitalize="characters"
            {...form.register('currency')}
          />
        </FormField>
      </div>

      <div className={withAssignee ? 'grid gap-5 sm:grid-cols-2' : 'grid gap-5'}>
        <FormField
          id={id('contactId')}
          label={t('common.contact')}
          error={errors.contactId?.message}
          description={t('leads.thePersonOrCompanyThis')}
        >
          <Controller
            control={form.control}
            name="contactId"
            render={({ field, fieldState }) => (
              <ContactPicker
                id={id('contactId')}
                aria-invalid={fieldState.error ? true : undefined}
                value={field.value || null}
                selected={contact}
                onValueChange={(next, summary) => {
                  field.onChange(next ?? '');
                  setContact(summary);
                }}
                disabled={disabled}
              />
            )}
          />
        </FormField>
        {withAssignee ? (
          <FormField
            id={id('assigneeId')}
            label={t('common.assignee')}
            error={errors.assigneeId?.message}
          >
            <Controller
              control={form.control}
              name="assigneeId"
              render={({ field, fieldState }) => (
                <AssigneePicker
                  id={id('assigneeId')}
                  aria-invalid={fieldState.error ? true : undefined}
                  value={field.value || null}
                  onValueChange={(next) => field.onChange(next ?? '')}
                  disabled={disabled}
                />
              )}
            />
          </FormField>
        ) : null}
      </div>

      <FormField
        id={id('tags')}
        label={t('common.tags')}
        error={errors.tags?.message}
        description={t('common.pressEnterOrCommaTo')}
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
              maxTags={20}
              disabled={disabled}
            />
          )}
        />
      </FormField>

      <FormField
        id={id('description')}
        label={t('common.description')}
        error={errors.description?.message}
      >
        <Textarea
          rows={3}
          placeholder={t('leads.whatTheyNeedBudgetTimeline')}
          {...form.register('description')}
        />
      </FormField>
    </fieldset>
  );
}
