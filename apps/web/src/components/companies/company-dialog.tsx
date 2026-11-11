'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Permission,
  createCompanySchema,
  type CompanyDetail,
  type Company,
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
  TagInput,
  Textarea,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useCreateCompany, useUpdateCompany } from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { AssigneePicker } from '@/components/crm/assignee-picker';
import { vm } from '@/i18n/validation';
import { useT } from '@/i18n/provider';

/** Browser-side shape ('' = none); the domain is normalised by the API contract. */
export const companyFormSchema = z.object({
  name: z.string().trim().min(1, vm('companies.enterAName')).max(160, vm('companies.keepTheNameUnder160')),
  domain: z.string().trim().max(160),
  notes: z.string().trim().max(5000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  ownerId: z.string(),
});
export type CompanyFormValues = z.infer<typeof companyFormSchema>;
const FIELDS = ['name', 'domain', 'notes', 'tags', 'ownerId'] as const;

export function companyFormDefaults(company?: Company | null): CompanyFormValues {
  return {
    name: company?.name ?? '',
    domain: company?.domain ?? '',
    notes: company?.notes ?? '',
    tags: company?.tags ?? [],
    ownerId: company?.ownerId ?? '',
  };
}

export function CompanyDialog({
  open,
  onOpenChange,
  company,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Company | CompanyDetail | null;
  onSaved?: (company: Company) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <CompanyForm
          company={company ?? null}
          onDone={(saved) => {
            onOpenChange(false);
            if (saved) onSaved?.(saved);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CompanyForm({ company, onDone }: { company: Company | null; onDone: (c?: Company) => void }) {
  const t = useT();
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const canOwner = useCan(Permission.MEMBERS_READ);
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: companyFormDefaults(company),
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      let saved: Company;
      if (company) {
        saved = await update.mutateAsync({
          id: company.id,
          body: {
            name: values.name,
            domain: values.domain || null,
            notes: values.notes || null,
            tags: values.tags,
            ownerId: values.ownerId || null,
          },
        });
        toast.success(t('companies.companySaved', { name: saved.name }));
      } else {
        saved = await create.mutateAsync(
          createCompanySchema.parse({
            name: values.name,
            domain: values.domain || undefined,
            notes: values.notes || undefined,
            tags: values.tags,
            ownerId: values.ownerId || undefined,
          }),
        );
        toast.success(t('companies.companyCreated', { name: saved.name }));
      }
      onDone(saved);
    } catch (error) {
      if (!applyServerErrors(error, form.setError, FIELDS)) setFormError(getErrorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>{company ? t('companies.editCompany') : t('companies.newCompany')}</DialogTitle>
        <DialogDescription>
          {company ? t('companies.editCompanyDescription') : t('companies.newCompanyDescription')}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <FormField id="company-name" label={t('common.name')} error={errors.name?.message} required>
          <Input autoFocus autoComplete="off" dir="auto" {...form.register('name')} />
        </FormField>
        <FormField
          id="company-domain"
          label={t('companies.domain')}
          description={t('companies.domainHint')}
          error={errors.domain?.message}
        >
          <Input dir="ltr" className="text-start" autoComplete="off" {...form.register('domain')} />
        </FormField>
        <div className={canOwner ? 'grid gap-5 sm:grid-cols-2' : 'grid gap-5'}>
          <FormField id="company-tags" label={t('common.tags')} description={t('common.pressEnterOrCommaTo')} error={errors.tags?.message}>
            <Controller
              control={form.control}
              name="tags"
              render={({ field }) => (
                <TagInput id="company-tags" value={field.value} onValueChange={field.onChange} maxTags={20} />
              )}
            />
          </FormField>
          {canOwner ? (
            <FormField id="company-ownerId" label={t('contacts.owner')} error={errors.ownerId?.message}>
              <Controller
                control={form.control}
                name="ownerId"
                render={({ field }) => (
                  <AssigneePicker
                    id="company-ownerId"
                    value={field.value || null}
                    onValueChange={(next) => field.onChange(next ?? '')}
                    emptyLabel={t('contacts.noOwner')}
                  />
                )}
              />
            </FormField>
          ) : null}
        </div>
        <FormField id="company-notes" label={t('common.notes')} error={errors.notes?.message}>
          <Textarea rows={3} dir="auto" {...form.register('notes')} />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {company ? t('common.saveChanges') : t('companies.createCompany')}
        </Button>
      </DialogFooter>
    </form>
  );
}
