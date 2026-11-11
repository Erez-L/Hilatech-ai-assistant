'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Permission, type DealWithRelations } from '@hilatech/contracts';
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
  TagInput,
  Textarea,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useCreateDeal, usePipelines, useUpdateDeal } from '@/hooks/sales';
import { useOrganizationSettings } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { contactName } from '@/lib/crm';
import { orderedStages } from '@/lib/deals';
import { AssigneePicker } from '@/components/crm/assignee-picker';
import { CompanyPicker } from '@/components/crm/company-picker';
import { ContactPicker } from '@/components/crm/contact-picker';
import { vm } from '@/i18n/validation';
import { useT } from '@/i18n/provider';

export const dealFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, vm('deals.enterATitle'))
    .max(200, vm('deals.keepTheTitleUnder200')),
  description: z.string().trim().max(5000),
  value: z
    .string()
    .trim()
    .refine((v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0), {
      message: vm('leads.enterAValidAmount'),
    }),
  currency: z.string().trim().length(3, vm('deals.currencyMustBe3Letters')),
  pipelineId: z.string(),
  stageId: z.string(),
  ownerId: z.string(),
  contactId: z.string(),
  companyId: z.string(),
  expectedCloseAt: z.string(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
});
export type DealFormValues = z.infer<typeof dealFormSchema>;
const FIELDS = [
  'title',
  'description',
  'value',
  'currency',
  'pipelineId',
  'stageId',
  'ownerId',
  'contactId',
  'companyId',
  'expectedCloseAt',
  'tags',
] as const;

export function dealFormDefaults(
  deal?: DealWithRelations | null,
  overrides: Partial<DealFormValues> = {},
): DealFormValues {
  return {
    title: deal?.title ?? '',
    description: deal?.description ?? '',
    value: deal?.value == null ? '' : String(deal.value),
    currency: deal?.currency ?? 'USD',
    pipelineId: deal?.pipelineId ?? '',
    stageId: deal?.stageId ?? '',
    ownerId: deal?.ownerId ?? '',
    contactId: deal?.contactId ?? '',
    companyId: deal?.companyId ?? '',
    expectedCloseAt: deal?.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : '',
    tags: deal?.tags ?? [],
    ...overrides,
  };
}

/** Local noon keeps the chosen calendar day stable across time zones once serialised to UTC. */
const dayToIso = (day: string) => new Date(`${day}T12:00:00`).toISOString();

export interface DealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this deal; omit to create. */
  deal?: DealWithRelations | null;
  /** Create in this pipeline / stage (board column "add"). */
  defaults?: Partial<Pick<DealFormValues, 'pipelineId' | 'stageId' | 'contactId' | 'companyId'>>;
  onSaved?: (deal: DealWithRelations) => void;
}

export function DealDialog({ open, onOpenChange, deal, defaults, onSaved }: DealDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DealForm
          deal={deal ?? null}
          defaults={defaults}
          onDone={(saved) => {
            onOpenChange(false);
            if (saved) onSaved?.(saved);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function DealForm({
  deal,
  defaults,
  onDone,
}: {
  deal: DealWithRelations | null;
  defaults?: DealDialogProps['defaults'];
  onDone: (deal?: DealWithRelations) => void;
}) {
  const t = useT();
  const create = useCreateDeal();
  const update = useUpdateDeal();
  const pipelines = usePipelines();
  const orgCurrency = useOrganizationSettings().data?.currency;
  const canMembers = useCan(Permission.MEMBERS_READ);
  const canContacts = useCan(Permission.CONTACTS_READ);
  const canCompanies = useCan(Permission.COMPANIES_READ);
  const [formError, setFormError] = React.useState<string | null>(null);
  const editing = !!deal;

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealFormSchema),
    defaultValues: dealFormDefaults(deal, {
      ...(orgCurrency && !deal ? { currency: orgCurrency } : {}),
      ...(defaults ?? {}),
    }),
  });
  const errors = form.formState.errors;
  const pipelineId = form.watch('pipelineId');
  const list = React.useMemo(() => pipelines.data ?? [], [pipelines.data]);
  const pipeline =
    list.find((p) => p.id === pipelineId) ?? list.find((p) => p.isDefault) ?? list[0];
  const stages = React.useMemo(() => (pipeline ? orderedStages(pipeline.stages) : []), [pipeline]);

  // New deals start in the default pipeline's first open stage and in the organization's currency.
  React.useEffect(() => {
    if (editing || !pipeline) return;
    if (!form.getValues('pipelineId')) form.setValue('pipelineId', pipeline.id);
    const current = form.getValues('stageId');
    if (!current || !stages.some((s) => s.id === current)) {
      const first = stages.find((s) => s.kind === 'open') ?? stages[0];
      if (first) form.setValue('stageId', first.id);
    }
  }, [editing, pipeline, stages, form]);
  React.useEffect(() => {
    if (!editing && orgCurrency && !form.getFieldState('currency').isDirty)
      form.setValue('currency', orgCurrency);
  }, [editing, orgCurrency, form]);

  const [contactLabel, setContactLabel] = React.useState<string | undefined>(
    deal?.contact ? contactName(deal.contact) : undefined,
  );
  const [companyLabel, setCompanyLabel] = React.useState<string | undefined>(deal?.company?.name);

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      let saved: DealWithRelations;
      if (deal) {
        saved = await update.mutateAsync({
          id: deal.id,
          body: {
            title: v.title,
            description: v.description || null,
            value: v.value === '' ? null : Number(v.value),
            currency: v.currency.toUpperCase(),
            ownerId: v.ownerId || null,
            contactId: v.contactId || null,
            companyId: v.companyId || null,
            expectedCloseAt: v.expectedCloseAt ? dayToIso(v.expectedCloseAt) : null,
            tags: v.tags,
          },
        });
        toast.success(t('deals.dealSaved', { title: saved.title }));
      } else {
        saved = await create.mutateAsync({
          title: v.title,
          description: v.description || undefined,
          value: v.value === '' ? undefined : Number(v.value),
          currency: v.currency.toUpperCase(),
          pipelineId: v.pipelineId || undefined,
          stageId: v.stageId || undefined,
          ownerId: v.ownerId || undefined,
          contactId: v.contactId || undefined,
          companyId: v.companyId || undefined,
          expectedCloseAt: v.expectedCloseAt ? dayToIso(v.expectedCloseAt) : undefined,
          tags: v.tags,
        });
        toast.success(t('deals.dealCreated', { title: saved.title }));
      }
      onDone(saved);
    } catch (error) {
      if (!applyServerErrors(error, form.setError, FIELDS)) setFormError(getErrorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>{editing ? t('deals.editDeal') : t('deals.newDeal')}</DialogTitle>
        <DialogDescription>
          {editing ? t('deals.editDealDescription') : t('deals.newDealDescription')}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <FormField id="deal-title" label={t('common.title')} error={errors.title?.message} required>
          <Input
            autoFocus
            autoComplete="off"
            dir="auto"
            placeholder={t('deals.dealTitlePlaceholder')}
            {...form.register('title')}
          />
        </FormField>

        {!editing ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="deal-pipelineId"
              label={t('deals.pipeline')}
              error={errors.pipelineId?.message}
            >
              <NativeSelect
                {...form.register('pipelineId', {
                  onChange: () => form.setValue('stageId', ''),
                })}
              >
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="deal-stageId" label={t('common.stage')} error={errors.stageId?.message}>
              <NativeSelect {...form.register('stageId')}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-[1fr_7rem_1fr]">
          <FormField id="deal-value" label={t('common.value')} error={errors.value?.message}>
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
            id="deal-currency"
            label={t('common.currency')}
            error={errors.currency?.message}
          >
            <Input
              maxLength={3}
              className="font-mono uppercase"
              autoCapitalize="characters"
              {...form.register('currency')}
            />
          </FormField>
          <FormField
            id="deal-expectedCloseAt"
            label={t('deals.expectedClose')}
            error={errors.expectedCloseAt?.message}
          >
            <Input
              type="date"
              dir="ltr"
              className="text-start"
              {...form.register('expectedCloseAt')}
            />
          </FormField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {canCompanies ? (
            <FormField
              id="deal-companyId"
              label={t('common.company')}
              error={errors.companyId?.message}
            >
              <Controller
                control={form.control}
                name="companyId"
                render={({ field }) => (
                  <CompanyPicker
                    id="deal-companyId"
                    value={field.value || null}
                    selectedLabel={companyLabel}
                    onValueChange={(next, company) => {
                      field.onChange(next ?? '');
                      setCompanyLabel(company?.name);
                    }}
                  />
                )}
              />
            </FormField>
          ) : null}
          {canContacts ? (
            <FormField
              id="deal-contactId"
              label={t('common.contact')}
              error={errors.contactId?.message}
            >
              <Controller
                control={form.control}
                name="contactId"
                render={({ field }) => (
                  <ContactPicker
                    id="deal-contactId"
                    value={field.value || null}
                    selected={
                      contactLabel
                        ? {
                            id: field.value,
                            firstName: contactLabel,
                            lastName: null,
                            email: null,
                            phone: null,
                            company: null,
                          }
                        : null
                    }
                    onValueChange={(next, contact) => {
                      field.onChange(next ?? '');
                      setContactLabel(contact ? contactName(contact) : undefined);
                    }}
                  />
                )}
              />
            </FormField>
          ) : null}
          {canMembers ? (
            <FormField
              id="deal-ownerId"
              label={t('contacts.owner')}
              error={errors.ownerId?.message}
            >
              <Controller
                control={form.control}
                name="ownerId"
                render={({ field }) => (
                  <AssigneePicker
                    id="deal-ownerId"
                    value={field.value || null}
                    onValueChange={(next) => field.onChange(next ?? '')}
                    emptyLabel={t('contacts.noOwner')}
                  />
                )}
              />
            </FormField>
          ) : null}
        </div>

        <FormField
          id="deal-tags"
          label={t('common.tags')}
          description={t('common.pressEnterOrCommaTo')}
          error={errors.tags?.message}
        >
          <Controller
            control={form.control}
            name="tags"
            render={({ field }) => (
              <TagInput
                id="deal-tags"
                value={field.value}
                onValueChange={field.onChange}
                maxTags={20}
              />
            )}
          />
        </FormField>
        <FormField
          id="deal-description"
          label={t('common.description')}
          error={errors.description?.message}
        >
          <Textarea rows={3} dir="auto" {...form.register('description')} />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {editing ? t('common.saveChanges') : t('deals.createDeal')}
        </Button>
      </DialogFooter>
    </form>
  );
}
