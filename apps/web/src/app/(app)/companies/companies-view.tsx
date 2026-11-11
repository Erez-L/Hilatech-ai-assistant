'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Building2, FilterX, Plus } from 'lucide-react';
import { Permission, type Company } from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  NativeSelect,
  PageHeader,
  Pagination,
  SearchInput,
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  type SortState,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useMembers } from '@/hooks/queries';
import { useCompanies } from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { fullName } from '@/lib/crm';
import { PermissionGate } from '@/components/common/permission-gate';
import { CompanyDialog } from '@/components/companies/company-dialog';
import { ExportButton } from '@/components/data-exchange/export-button';
import { ImportButton } from '@/components/data-exchange/import-wizard';
import { useFormat, useT } from '@/i18n/provider';

const PAGE_SIZE = 20;
type SortKey = 'name' | 'createdAt' | 'updatedAt';

export function CompaniesView() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canCreate = useCan(Permission.COMPANIES_CREATE);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [ownerId, setOwnerId] = React.useState('');
  const [tagDraft, setTagDraft] = React.useState('');
  const [tag, setTag] = React.useState('');
  const [sort, setSort] = React.useState<SortState<SortKey>>({ key: 'name', direction: 'asc' });
  const [createOpen, setCreateOpen] = React.useState(searchParams.get('new') === '1');

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setTag(tagDraft.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [tagDraft]);

  const query = {
    search: search || undefined,
    ownerId: ownerId || undefined,
    tag: tag || undefined,
    sortBy: sort.key,
    sortOrder: sort.direction,
  } as const;
  const companies = useCompanies({ ...query, page, pageSize: PAGE_SIZE });
  const members = useMembers({ page: 1, pageSize: 100 });
  const owners = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.data?.data ?? []) map.set(m.userId, fullName(m.user));
    return map;
  }, [members.data]);

  const hasFilters = !!(search || ownerId || tag);
  const reset = () => {
    setSearch('');
    setOwnerId('');
    setTagDraft('');
    setTag('');
    setPage(1);
  };

  return (
    <PermissionGate anyOf={[Permission.COMPANIES_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('companies.companies')}
          description={t('companies.theOrganizationsYouSellTo')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ImportButton entity="companies" />
              <ExportButton entity="companies" filters={query} label={t('companies.companies')} />
              {canCreate ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreateOpen(true)}>
                  {t('companies.newCompany')}
                </Button>
              ) : null}
            </div>
          }
        />

        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.6fr_1fr_1fr_auto] xl:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="companies-search">{t('common.search')}</Label>
                <SearchInput
                  id="companies-search"
                  value={search}
                  onValueChange={(v) => {
                    setSearch(v);
                    setPage(1);
                  }}
                  placeholder={t('companies.nameOrDomain')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="companies-owner">{t('contacts.owner')}</Label>
                <NativeSelect
                  id="companies-owner"
                  value={ownerId}
                  onChange={(e) => {
                    setOwnerId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('common.anyone')}</option>
                  {(members.data?.data ?? []).map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {fullName(m.user)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="companies-tag">{t('common.tag')}</Label>
                <Input
                  id="companies-tag"
                  value={tagDraft}
                  placeholder={t('leads.anyTag')}
                  onChange={(e) => setTagDraft(e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                onClick={reset}
                disabled={!hasFilters}
                leadingIcon={<FilterX aria-hidden />}
              >
                {t('common.clear')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    sortKey="name"
                    sort={sort}
                    onSortChange={(s) => {
                      setSort(s);
                      setPage(1);
                    }}
                  >
                    {t('common.name')}
                  </SortableHead>
                  <TableHead>{t('companies.domain')}</TableHead>
                  <TableHead>{t('common.tags')}</TableHead>
                  <TableHead>{t('contacts.owner')}</TableHead>
                  <SortableHead
                    sortKey="updatedAt"
                    sort={sort}
                    onSortChange={(s) => {
                      setSort(s);
                      setPage(1);
                    }}
                  >
                    {t('common.updated')}
                  </SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.isPending ? (
                  <TableSkeletonRows columns={5} rows={8} />
                ) : companies.isError ? (
                  <TableEmptyRow colSpan={5}>
                    <div className="flex flex-col items-center gap-2">
                      <span>{getErrorMessage(companies.error)}</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void companies.refetch()}
                      >
                        {t('common.tryAgain')}
                      </Button>
                    </div>
                  </TableEmptyRow>
                ) : companies.data.data.length === 0 ? (
                  <TableEmptyRow colSpan={5} className="py-4">
                    <EmptyState
                      compact
                      icon={<Building2 />}
                      title={
                        hasFilters
                          ? t('companies.noCompaniesMatchTheseFilters')
                          : t('companies.noCompaniesYet')
                      }
                      description={
                        hasFilters
                          ? t('common.tryDifferentFilters')
                          : t('companies.addYourFirstCompany')
                      }
                      action={
                        hasFilters ? (
                          <Button variant="secondary" size="sm" onClick={reset}>
                            {t('common.clearFilters')}
                          </Button>
                        ) : canCreate ? (
                          <Button
                            size="sm"
                            leadingIcon={<Plus aria-hidden />}
                            onClick={() => setCreateOpen(true)}
                          >
                            {t('companies.newCompany')}
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableEmptyRow>
                ) : (
                  companies.data.data.map((company) => (
                    <CompanyRow
                      key={company.id}
                      company={company}
                      owner={company.ownerId ? owners.get(company.ownerId) : undefined}
                      onOpen={(id) => router.push(`/companies/${id}`)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
            {companies.data && companies.data.meta.total > PAGE_SIZE ? (
              <div className="border-t border-border px-5 py-3">
                <Pagination
                  page={companies.data.meta.page}
                  pageSize={companies.data.meta.pageSize}
                  total={companies.data.meta.total}
                  onPageChange={setPage}
                  itemLabel={t('companies.companiesLower')}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <CompanyDialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open && searchParams.get('new')) router.replace('/companies');
          }}
          onSaved={(company) => router.push(`/companies/${company.id}`)}
        />
      </div>
    </PermissionGate>
  );
}

function CompanyRow({
  company,
  owner,
  onOpen,
}: {
  company: Company;
  owner?: string;
  onOpen: (id: string) => void;
}) {
  const fmt = useFormat();
  return (
    <TableRow
      className="cursor-pointer"
      data-testid="company-row"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a,button')) return;
        onOpen(company.id);
      }}
    >
      <TableCell>
        <Link
          href={`/companies/${company.id}`}
          dir="auto"
          className="truncate font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {company.name}
        </Link>
      </TableCell>
      <TableCell className="text-fg-muted">
        {company.domain ? (
          <span dir="ltr">{company.domain}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {company.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline" className="px-1.5 py-0 text-[0.625rem] leading-4">
              {tag}
            </Badge>
          ))}
          {company.tags.length === 0 ? <span className="text-fg-subtle">—</span> : null}
        </div>
      </TableCell>
      <TableCell className="text-fg-muted">
        {owner ?? <span className="text-fg-subtle">—</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-fg-muted tabular">
        <time
          dateTime={company.updatedAt}
          title={fmt.dateTime(new Date(company.updatedAt), 'long')}
        >
          {fmt.relative(new Date(company.updatedAt))}
        </time>
      </TableCell>
    </TableRow>
  );
}
