'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, Handshake, Pencil, Trash2, UserMinus, Users } from 'lucide-react';
import { Permission, type CompanyDetail } from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PageHeader,
  Skeleton,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import {
  useAssociateContacts,
  useCompany,
  useCompanyContacts,
  useDealsForCompany,
  useDeleteCompany,
  useDissociateContact,
} from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { contactMeta, contactName } from '@/lib/crm';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { ContactPicker } from '@/components/crm/contact-picker';
import { UserChip } from '@/components/crm/user-chip';
import { CompanyDialog } from '@/components/companies/company-dialog';
import { DealStatusBadge } from '@/components/deals/deal-badges';
import { useFormat, useT } from '@/i18n/provider';

export function CompanyDetailView({ id }: { id: string }) {
  const t = useT();
  const company = useCompany(id);
  return (
    <PermissionGate anyOf={[Permission.COMPANIES_READ]}>
      <QueryState
        query={company}
        loading={
          <div className="flex flex-col gap-6" aria-busy>
            <Skeleton className="h-8 w-72" />
            <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
              <Skeleton className="h-72 rounded-lg" />
              <Skeleton className="h-48 rounded-lg" />
            </div>
          </div>
        }
        errorTitle={t('companies.thisCompanyCouldnTBe')}
      >
        {(data) => <CompanyBody company={data} />}
      </QueryState>
      {company.isError && isApiError(company.error) && company.error.isNotFound ? (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary" leadingIcon={<ArrowLeft aria-hidden />}>
            <Link href="/companies">{t('companies.backToCompanies')}</Link>
          </Button>
        </div>
      ) : null}
    </PermissionGate>
  );
}

function CompanyBody({ company }: { company: CompanyDetail }) {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const canUpdate = useCan(Permission.COMPANIES_UPDATE);
  const canDelete = useCan(Permission.COMPANIES_DELETE);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const remove = useDeleteCompany();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/companies" className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3.5" aria-hidden />
            {t('companies.companies')}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Building2 className="size-6 text-fg-subtle" aria-hidden />
            <span dir="auto">{company.name}</span>
          </span>
        }
        description={company.domain ? <span dir="ltr">{company.domain}</span> : undefined}
        actions={
          <>
            {canUpdate ? (
              <Button variant="secondary" leadingIcon={<Pencil aria-hidden />} onClick={() => setEditOpen(true)}>
                {t('common.edit')}
              </Button>
            ) : null}
            {canDelete ? (
              <Button variant="secondary" leadingIcon={<Trash2 aria-hidden />} onClick={() => setDeleteOpen(true)}>
                {t('common.delete')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <CompanyContacts company={company} canUpdate={canUpdate} />
          <CompanyDeals companyId={company.id} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t('common.details')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              <dt className="text-fg-muted">{t('contacts.owner')}</dt>
              <dd>
                <UserChip user={company.owner} emptyLabel={t('contacts.noOwner')} />
              </dd>
              <dt className="text-fg-muted">{t('common.contacts')}</dt>
              <dd className="tabular">{company.contactCount}</dd>
              <dt className="text-fg-muted">{t('deals.deals')}</dt>
              <dd className="tabular">{company.dealCount}</dd>
              <dt className="text-fg-muted">{t('common.tags')}</dt>
              <dd className="flex flex-wrap gap-1">
                {company.tags.length > 0 ? (
                  company.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </dd>
              <dt className="text-fg-muted">{t('common.notes')}</dt>
              <dd className="whitespace-pre-wrap" dir="auto">
                {company.notes ?? '—'}
              </dd>
              <dt className="text-fg-muted">{t('contacts.added')}</dt>
              <dd>
                <time dateTime={company.createdAt}>{fmt.date(new Date(company.createdAt))}</time>
              </dd>
              <dt className="text-fg-muted">{t('common.updated')}</dt>
              <dd className="tabular">{fmt.relative(new Date(company.updatedAt))}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <CompanyDialog open={editOpen} onOpenChange={setEditOpen} company={company} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('companies.deleteCompanyTitle', { name: company.name })}
        description={t('companies.deleteCompanyBody')}
        confirmLabel={t('companies.deleteCompany')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(company.id, {
            onSuccess: () => {
              toast.success(t('companies.companyDeleted', { name: company.name }));
              router.replace('/companies');
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}

function CompanyContacts({ company, canUpdate }: { company: CompanyDetail; canUpdate: boolean }) {
  const t = useT();
  const canContacts = useCan(Permission.CONTACTS_READ);
  const canLink = useCan(Permission.CONTACTS_UPDATE) && canUpdate;
  const contacts = useCompanyContacts(company.id, { page: 1, pageSize: 50 });
  const associate = useAssociateContacts();
  const dissociate = useDissociateContact();
  const [picked, setPicked] = React.useState<string | null>(null);

  if (!canContacts) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('common.contacts')}</CardTitle>
        <CardDescription>{t('companies.peopleAtThisCompany')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canLink ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="company-link-contact" className="text-sm font-medium">
                {t('companies.linkAContact')}
              </label>
              <ContactPicker
                id="company-link-contact"
                value={picked}
                onValueChange={(next) => setPicked(next)}
              />
            </div>
            <Button
              variant="secondary"
              disabled={!picked}
              loading={associate.isPending}
              onClick={() =>
                picked &&
                associate.mutate(
                  { id: company.id, contactIds: [picked] },
                  {
                    onSuccess: () => {
                      setPicked(null);
                      toast.success(t('companies.contactLinked'));
                    },
                    onError: (e) => toast.error(getErrorMessage(e)),
                  },
                )
              }
            >
              {t('companies.link')}
            </Button>
          </div>
        ) : null}
        <QueryState
          query={contacts}
          compact
          loading={<Skeleton className="h-16 w-full" />}
          isEmpty={(r) => r.data.length === 0}
          empty={
            <EmptyState compact icon={<Users />} title={t('companies.noContactsLinked')} description={t('companies.noContactsLinkedHint')} />
          }
        >
          {(r) => (
            <ul className="divide-y divide-border" aria-label={t('common.contacts')}>
              {r.data.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5" data-testid="company-contact">
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/contacts/${c.id}`} dir="auto" className="truncate font-medium hover:underline">
                      {contactName(c)}
                    </Link>
                    <span className="truncate text-xs text-fg-muted" dir="auto">
                      {contactMeta(c) ?? '—'}
                    </span>
                  </div>
                  {canLink ? (
                    <IconButton
                      label={t('companies.unlinkContact', { name: contactName(c) })}
                      onClick={() =>
                        dissociate.mutate(
                          { id: company.id, contactId: c.id },
                          {
                            onSuccess: () => toast.success(t('companies.contactUnlinked')),
                            onError: (e) => toast.error(getErrorMessage(e)),
                          },
                        )
                      }
                    >
                      <UserMinus aria-hidden />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function CompanyDeals({ companyId }: { companyId: string }) {
  const t = useT();
  const fmt = useFormat();
  const canDeals = useCan(Permission.DEALS_READ);
  const deals = useDealsForCompany(companyId, canDeals);
  if (!canDeals) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('deals.deals')}</CardTitle>
        <CardDescription>{t('companies.dealsWithThisCompany')}</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={deals}
          compact
          loading={<Skeleton className="h-16 w-full" />}
          isEmpty={(r) => r.data.length === 0}
          empty={<EmptyState compact icon={<Handshake />} title={t('companies.noDealsYet')} description={t('companies.noDealsYetHint')} />}
        >
          {(r) => (
            <ul className="divide-y divide-border" aria-label={t('deals.deals')}>
              {r.data.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/deals/${d.id}`} dir="auto" className="truncate font-medium hover:underline">
                      {d.title}
                    </Link>
                    <span className="text-xs text-fg-muted">
                      {d.stage.name}
                      {d.value != null ? ` · ${fmt.currency(d.value, d.currency)}` : ''}
                    </span>
                  </div>
                  <DealStatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
