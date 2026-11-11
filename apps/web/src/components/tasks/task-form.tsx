'use client';

import * as React from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import {
  Permission,
  type CreateTaskRequest,
  type TaskPriority,
  type TaskWithRelations,
  type UpdateTaskRequest,
} from '@hilatech/contracts';
import { FormField, Input, NativeSelect, Textarea } from '@hilatech/ui';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import { vm } from '@/i18n/validation';
import { useT } from '@/i18n/provider';
import { AssigneePicker } from '@/components/crm/assignee-picker';
import { ContactPicker } from '@/components/crm/contact-picker';
import { LeadPicker } from '@/components/crm/lead-picker';
import { DealPicker } from '@/components/crm/deal-picker';
import { ConversationPicker } from '@/components/crm/conversation-picker';
import { contactName } from '@/lib/crm';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  isoToLocalInput,
  localInputToIso,
} from '@/lib/tasks';

const optionalLocal = z.string();

/** Browser-side shape: every control holds a string ('' = none). */
export const taskFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, vm('tasks.enterATitle'))
      .max(200, vm('tasks.keepTheTitleUnder200')),
    description: z.string().trim().max(5000, vm('tasks.descriptionTooLong')),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    status: z.enum(['todo', 'in_progress', 'cancelled']),
    dueAt: optionalLocal,
    reminderAt: optionalLocal,
    assigneeId: z.string(),
    leadId: z.string(),
    contactId: z.string(),
    dealId: z.string(),
    conversationId: z.string(),
  })
  .refine(
    (v) => {
      const due = localInputToIso(v.dueAt);
      const reminder = localInputToIso(v.reminderAt);
      return !due || !reminder || new Date(reminder).getTime() <= new Date(due).getTime();
    },
    { message: vm('tasks.reminderAfterDue'), path: ['reminderAt'] },
  );
export type TaskFormInput = z.input<typeof taskFormSchema>;
export type TaskFormValues = z.output<typeof taskFormSchema>;

export const TASK_FORM_FIELDS = [
  'title',
  'description',
  'priority',
  'status',
  'dueAt',
  'reminderAt',
  'assigneeId',
  'leadId',
  'contactId',
  'dealId',
  'conversationId',
] as const;

export function taskFormDefaults(
  task?: TaskWithRelations | null,
  overrides: Partial<TaskFormInput> = {},
): TaskFormInput {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    priority: task?.priority ?? 'medium',
    status: task && task.status !== 'done' ? (task.status as 'todo' | 'in_progress' | 'cancelled') : 'todo',
    dueAt: isoToLocalInput(task?.dueAt),
    reminderAt: isoToLocalInput(task?.reminderAt),
    assigneeId: task?.assigneeId ?? '',
    leadId: task?.leadId ?? '',
    contactId: task?.contactId ?? '',
    dealId: task?.dealId ?? '',
    conversationId: task?.conversationId ?? '',
    ...overrides,
  };
}

export function toCreateTaskRequest(values: TaskFormValues): CreateTaskRequest {
  return {
    title: values.title,
    description: values.description || undefined,
    priority: values.priority as TaskPriority,
    status: values.status === 'cancelled' ? 'todo' : values.status,
    dueAt: localInputToIso(values.dueAt),
    reminderAt: localInputToIso(values.reminderAt),
    assigneeId: values.assigneeId || undefined,
    leadId: values.leadId || undefined,
    contactId: values.contactId || undefined,
    dealId: values.dealId || undefined,
    conversationId: values.conversationId || undefined,
  };
}

/** PATCH body: cleared fields are sent as null so they clear on the server. */
export function toUpdateTaskRequest(values: TaskFormValues, allowStatus: boolean): UpdateTaskRequest {
  return {
    title: values.title,
    description: values.description || null,
    priority: values.priority as TaskPriority,
    ...(allowStatus ? { status: values.status } : {}),
    dueAt: localInputToIso(values.dueAt) ?? null,
    reminderAt: localInputToIso(values.reminderAt) ?? null,
    assigneeId: values.assigneeId || null,
    leadId: values.leadId || null,
    contactId: values.contactId || null,
    dealId: values.dealId || null,
    conversationId: values.conversationId || null,
  };
}

export interface RelatedLabels {
  lead?: string;
  contact?: string;
  deal?: string;
  conversation?: string;
}

export function TaskFormFields({
  form,
  idPrefix = 'task',
  editing = false,
  labels = {},
  disabled = false,
  autoFocusTitle = false,
  hideRelated,
}: {
  form: UseFormReturn<TaskFormInput, unknown, TaskFormValues>;
  idPrefix?: string;
  editing?: boolean;
  labels?: RelatedLabels;
  disabled?: boolean;
  autoFocusTitle?: boolean;
  /** Related kinds fixed by the page (e.g. the lead the dialog was opened from). */
  hideRelated?: ReadonlyArray<'lead' | 'contact' | 'deal' | 'conversation'>;
}) {
  const t = useT();
  const errors = form.formState.errors;
  const me = useSession((s) => s.user);
  const canAssign = useCan(Permission.TASKS_ASSIGN);
  const canLeads = useCan(Permission.LEADS_READ);
  const canContacts = useCan(Permission.CONTACTS_READ);
  const canDeals = useCan(Permission.DEALS_READ);
  const canConversations = useCan(Permission.CONVERSATIONS_READ);
  const id = (name: string) => `${idPrefix}-${name}`;
  const hidden = new Set(hideRelated ?? []);
  const [known, setKnown] = React.useState<RelatedLabels>(labels);

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-5">
      <FormField id={id('title')} label={t('common.title')} error={errors.title?.message} required>
        <Input
          autoFocus={autoFocusTitle}
          autoComplete="off"
          dir="auto"
          placeholder={t('tasks.callBackAboutTheProposal')}
          {...form.register('title')}
        />
      </FormField>

      <FormField id={id('description')} label={t('common.description')} error={errors.description?.message}>
        <Textarea rows={3} dir="auto" {...form.register('description')} />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id={id('priority')} label={t('tasks.priority')} error={errors.priority?.message}>
          <NativeSelect {...form.register('priority')}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(TASK_PRIORITY_LABELS[p])}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {editing ? (
          <FormField id={id('status')} label={t('common.status')} error={errors.status?.message}>
            <NativeSelect {...form.register('status')}>
              {(['todo', 'in_progress', 'cancelled'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(TASK_STATUS_LABELS[s])}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : (
          <FormField
            id={id('assigneeId')}
            label={t('common.assignee')}
            error={errors.assigneeId?.message}
          >
            <Controller
              control={form.control}
              name="assigneeId"
              render={({ field, fieldState }) => (
                <AssigneeField
                  id={id('assigneeId')}
                  invalid={!!fieldState.error}
                  value={field.value}
                  onChange={field.onChange}
                  canAssign={canAssign}
                  meId={me?.id ?? null}
                  disabled={disabled}
                />
              )}
            />
          </FormField>
        )}
      </div>

      {editing ? (
        <FormField id={id('assigneeId')} label={t('common.assignee')} error={errors.assigneeId?.message}>
          <Controller
            control={form.control}
            name="assigneeId"
            render={({ field, fieldState }) => (
              <AssigneeField
                id={id('assigneeId')}
                invalid={!!fieldState.error}
                value={field.value}
                onChange={field.onChange}
                canAssign={canAssign}
                meId={me?.id ?? null}
                disabled={disabled}
              />
            )}
          />
        </FormField>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id={id('dueAt')} label={t('tasks.dueDate')} error={errors.dueAt?.message}>
          <Input type="datetime-local" dir="ltr" className="text-start" {...form.register('dueAt')} />
        </FormField>
        <FormField
          id={id('reminderAt')}
          label={t('tasks.reminder')}
          description={t('tasks.reminderHint')}
          error={errors.reminderAt?.message}
        >
          <Input type="datetime-local" dir="ltr" className="text-start" {...form.register('reminderAt')} />
        </FormField>
      </div>

      {(['lead', 'contact', 'deal', 'conversation'] as const).some(
        (k) =>
          !hidden.has(k) &&
          { lead: canLeads, contact: canContacts, deal: canDeals, conversation: canConversations }[k],
      ) ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">{t('tasks.relatedRecords')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {canLeads && !hidden.has('lead') ? (
              <FormField id={id('leadId')} label={t('common.lead')} error={errors.leadId?.message}>
                <Controller
                  control={form.control}
                  name="leadId"
                  render={({ field }) => (
                    <LeadPicker
                      id={id('leadId')}
                      value={field.value || null}
                      selectedLabel={known.lead}
                      onValueChange={(next, lead) => {
                        field.onChange(next ?? '');
                        setKnown((k) => ({ ...k, lead: lead?.title }));
                      }}
                      disabled={disabled}
                    />
                  )}
                />
              </FormField>
            ) : null}
            {canContacts && !hidden.has('contact') ? (
              <FormField id={id('contactId')} label={t('common.contact')} error={errors.contactId?.message}>
                <Controller
                  control={form.control}
                  name="contactId"
                  render={({ field }) => (
                    <ContactPicker
                      id={id('contactId')}
                      value={field.value || null}
                      selected={
                        known.contact
                          ? { id: field.value, firstName: known.contact, lastName: null, email: null, phone: null, company: null }
                          : null
                      }
                      onValueChange={(next, contact) => {
                        field.onChange(next ?? '');
                        setKnown((k) => ({ ...k, contact: contact ? contactName(contact) : undefined }));
                      }}
                      disabled={disabled}
                    />
                  )}
                />
              </FormField>
            ) : null}
            {canDeals && !hidden.has('deal') ? (
              <FormField id={id('dealId')} label={t('deals.deal')} error={errors.dealId?.message}>
                <Controller
                  control={form.control}
                  name="dealId"
                  render={({ field }) => (
                    <DealPicker
                      id={id('dealId')}
                      value={field.value || null}
                      selectedLabel={known.deal}
                      onValueChange={(next, deal) => {
                        field.onChange(next ?? '');
                        setKnown((k) => ({ ...k, deal: deal?.title }));
                      }}
                      disabled={disabled}
                    />
                  )}
                />
              </FormField>
            ) : null}
            {canConversations && !hidden.has('conversation') ? (
              <FormField
                id={id('conversationId')}
                label={t('tasks.conversation')}
                error={errors.conversationId?.message}
              >
                <Controller
                  control={form.control}
                  name="conversationId"
                  render={({ field }) => (
                    <ConversationPicker
                      id={id('conversationId')}
                      value={field.value || null}
                      selectedLabel={known.conversation}
                      onValueChange={(next, conversation) => {
                        field.onChange(next ?? '');
                        setKnown((k) => ({ ...k, conversation: conversation?.subject ?? undefined }));
                      }}
                      disabled={disabled}
                    />
                  )}
                />
              </FormField>
            ) : null}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

/** With tasks:assign: every active member. Without it the API only accepts "me" or nobody. */
function AssigneeField({
  id,
  value,
  onChange,
  canAssign,
  meId,
  invalid,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  canAssign: boolean;
  meId: string | null;
  invalid: boolean;
  disabled: boolean;
}) {
  const t = useT();
  if (canAssign) {
    return (
      <AssigneePicker
        id={id}
        aria-invalid={invalid || undefined}
        value={value || null}
        onValueChange={(next) => onChange(next ?? '')}
        disabled={disabled}
      />
    );
  }
  return (
    <NativeSelect
      id={id}
      value={value === meId ? value : ''}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('common.unassigned')}</option>
      {meId ? <option value={meId}>{t('tasks.assignToMe')}</option> : null}
    </NativeSelect>
  );
}
