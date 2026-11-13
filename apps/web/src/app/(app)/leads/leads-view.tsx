'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Target, X } from 'lucide-react';
import {
  Permission,
  type LeadSource,
  type LeadStatus,
  type LeadWithRelations,
  type ListLeadsQuery,
} from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  FilterBar,
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
import { useContact, useLeads, useMembers } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import {
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  contactName,
  fullName,
} from '@/lib/crm';
import { ExportButton } from '@/components/data-exchange/export-button';
import { ImportButton } from '@/components/data-exchange/import-wizard';
import { PermissionGate } from '@/components/common/permission-gate';
import { LeadStatusBadge } from '@/components/crm/badges';
import { UserChip } from '@/components/crm/user-chip';
import { LeadDialog } from './lead-dialog';
import { useT, useFormat } from '@/i18n/provider';

const PAGE_SIZE = 20;
type SortKey = ListLeadsQuery['sortBy'];

export function LeadsView() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canCreate = useCan(Permission.LEADS_CREATE);
  const canReadMembers = useCan(Permission.MEMBERS_READ);

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<LeadStatus | ''>(
    (searchParams.get('status') as LeadStatus | null) ?? '',
  );
  const [source, setSource] = React.useState<LeadSource | ''>('');
  const [assigneeId, setAssigneeId] = React.useState(searchParams.get('assigneeId') ?? '');
  const [contactId, setContactId] = React.useState(searchParams.get('contactId') ?? '');
  const [tag, setTag] = React.useState('');
  const [tagDraft, setTagDraft] = React.useState('');
  const [sort, setSort] = React.useState<SortState<SortKey>>({
    key: 'createdAt',
    direction: 'desc',
  });
  const [createOpen, setCreateOpen] = React.useState(searchParams.get('new') === '1');

  React.useEffect(() => {
    const t = setTimeout(() => {
      setTag(tagDraft.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [tagDraft]);

  const leads = useLeads({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: status || undefined,
    source: source || undefined,
    assigneeId: assigneeId || undefined,
    contactId: contactId || undefined,
    tag: tag || undefined,
    sortBy: sort.key,
    sortOrder: sort.direction,
  });
  const members = useMembers({ page: 1, pageSize: 100 });

  const hasFilters = !!(search || status || source || assigneeId || contactId || tag);
  const reset = () => {
    setSearch('');
    setStatus('');
    setSource('');
    setAssigneeId('');
    setContactId('');
    setTagDraft('');
    setTag('');
    setPage(1);
    if (searchParams.toString()) router.replace('/leads');
  };
  const contactFilter = useContact(contactId || null);

  const knownTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const l of leads.data?.data ?? []) for (const t of l.tags) set.add(t);
    return Array.from(set).sort();
  }, [leads.data]);

  const closeCreate = (open: boolean) => {
    setCreateOpen(open);
    if (!open && searchParams.get('new')) router.replace('/leads');
  };

  return (
    <PermissionGate anyOf={[Permission.LEADS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('common.leads')}
          description={t('leads.everyOpportunityFromFirstContact')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ImportButton entity="leads" />
              <ExportButton
                entity="leads"
                label={t('common.leads')}
                filters={{
                  search: search || undefined,
                  status: status || undefined,
                  source: source || undefined,
                  assigneeId: assigneeId || undefined,
                  contactId: contactId || undefined,
                  tag: tag || undefined,
                  sortBy: sort.key,
                  sortOrder: sort.direction,
                }}
              />
              {canCreate ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreateOpen(true)}>
                  {t('common.newLead')}
                </Button>
              ) : null}
            </div>
          }
        />

        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            <FilterBar
              labels={{ filters: t('common.filters'), clear: t('common.clear') }}
              activeCount={[status, source, assigneeId, tag].filter(Boolean).length}
              onClear={reset}
              canClear={hasFilters}
              search={
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leads-search">{t('common.search')}</Label>
                  <SearchInput
                    id="leads-search"
                    value={search}
                    onValueChange={(v) => {
                      setSearch(v);
                      setPage(1);
                    }}
                    placeholder={t('leads.titleContactOrDescription')}
                  />
                </div>
              }
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leads-status">{t('common.stage')}</Label>
                <NativeSelect
                  id="leads-status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as LeadStatus | '');
                    setPage(1);
                  }}
                >
                  <option value="">{t('leads.allStages')}</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(LEAD_STATUS_LABELS[s])}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leads-source">{t('common.source')}</Label>
                <NativeSelect
                  id="leads-source"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as LeadSource | '');
                    setPage(1);
                  }}
                >
                  <option value="">{t('leads.allSources')}</option>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {t(LEAD_SOURCE_LABELS[s])}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leads-assignee">{t('common.assignee')}</Label>
                <NativeSelect
                  id="leads-assignee"
                  value={assigneeId}
                  disabled={!canReadMembers}
                  onChange={(e) => {
                    setAssigneeId(e.target.value);
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
                <Label htmlFor="leads-tag">{t('common.tag')}</Label>
                <Input
                  id="leads-tag"
                  value={tagDraft}
                  list="leads-known-tags"
                  placeholder={t('leads.anyTag')}
                  onChange={(e) => setTagDraft(e.target.value)}
                />
                <datalist id="leads-known-tags">
                  {knownTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </FilterBar>
            {contactId ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <span>{t('leads.showingLeadsFor')}</span>
                <Badge variant="accent" className="gap-1.5 pe-1">
                  {contactFilter.data ? contactName(contactFilter.data) : t('leads.oneContact')}
                  <button
                    type="button"
                    aria-label={t('leads.removeContactFilter')}
                    className="flex size-4 items-center justify-center rounded-full hover:bg-accent/20"
                    onClick={() => {
                      setContactId('');
                      setPage(1);
                      router.replace('/leads');
                    }}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </Badge>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <LeadsTable
              query={leads}
              sort={sort}
              onSortChange={(next) => {
                setSort(next);
                setPage(1);
              }}
              hasFilters={hasFilters}
              onClear={reset}
              canCreate={canCreate}
              onCreate={() => setCreateOpen(true)}
              onOpen={(id) => router.push(`/leads/${id}`)}
            />
            {leads.data && leads.data.meta.total > PAGE_SIZE ? (
              <div className="border-t border-border px-5 py-3">
                <Pagination
                  page={leads.data.meta.page}
                  pageSize={leads.data.meta.pageSize}
                  total={leads.data.meta.total}
                  onPageChange={setPage}
                  itemLabel={t('leads.leadsLower')}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <LeadDialog
          open={createOpen}
          onOpenChange={closeCreate}
          onCreated={(lead) => router.push(`/leads/${lead.id}`)}
        />
      </div>
    </PermissionGate>
  );
}

// ---------------------------------------------------------------------------

function LeadsTable({
  query,
  sort,
  onSortChange,
  hasFilters,
  onClear,
  canCreate,
  onCreate,
  onOpen,
}: {
  query: ReturnType<typeof useLeads>;
  sort: SortState<SortKey>;
  onSortChange: (next: SortState<SortKey>) => void;
  hasFilters: boolean;
  onClear: () => void;
  canCreate: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const columns = 7;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead sortKey="title" sort={sort} onSortChange={onSortChange}>
            {t('common.lead')}
          </SortableHead>
          <TableHead>{t('common.contact')}</TableHead>
          <TableHead>{t('common.stage')}</TableHead>
          <SortableHead sortKey="value" sort={sort} onSortChange={onSortChange}>
            {t('common.value')}
          </SortableHead>
          <TableHead>{t('common.source')}</TableHead>
          <TableHead>{t('common.assignee')}</TableHead>
          <SortableHead sortKey="updatedAt" sort={sort} onSortChange={onSortChange}>
            {t('common.updated')}
          </SortableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.isPending ? (
          <TableSkeletonRows columns={columns} rows={8} />
        ) : query.isError ? (
          <TableEmptyRow colSpan={columns}>
            <div className="flex flex-col items-center gap-2">
              <span>{getErrorMessage(query.error)}</span>
              <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                {t('common.tryAgain')}
              </Button>
            </div>
          </TableEmptyRow>
        ) : query.data.data.length === 0 ? (
          <TableEmptyRow colSpan={columns} className="py-4">
            <EmptyState
              compact
              icon={<Target />}
              title={hasFilters ? t('leads.noLeadsMatchTheseFilters') : t('common.noLeadsYet')}
              description={
                hasFilters ? t('leads.tryADifferentStageSource') : t('leads.addYourFirstLeadTo')
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={onClear}>
                    {t('common.clearFilters')}
                  </Button>
                ) : canCreate ? (
                  <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={onCreate}>
                    {t('common.newLead')}
                  </Button>
                ) : undefined
              }
            />
          </TableEmptyRow>
        ) : (
          query.data.data.map((lead) => <LeadRow key={lead.id} lead={lead} onOpen={onOpen} />)
        )}
      </TableBody>
    </Table>
  );
}

function LeadRow({ lead, onOpen }: { lead: LeadWithRelations; onOpen: (id: string) => void }) {
  const fmt = useFormat();
  const t = useT();
  return (
    <TableRow
      className="cursor-pointer"
      onClick={(event) => {
        // Let inner links/buttons handle their own clicks.
        if ((event.target as HTMLElement).closest('a,button')) return;
        onOpen(lead.id);
      }}
    >
      <TableCell>
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/leads/${lead.id}`}
            className="truncate font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {lead.title}
          </Link>
          {lead.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {lead.tags.slice(0, 3).map((t) => (
                <Badge key={t} variant="outline" className="px-1.5 py-0 text-[0.625rem] leading-4">
                  {t}
                </Badge>
              ))}
              {lead.tags.length > 3 ? (
                <span className="text-2xs text-fg-subtle">+{lead.tags.length - 3}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {lead.contact ? (
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/contacts/${lead.contact.id}`}
              className="truncate hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {contactName(lead.contact)}
            </Link>
            {lead.contact.company ? (
              <span className="truncate text-xs text-fg-muted">{lead.contact.company}</span>
            ) : null}
          </div>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </TableCell>
      <TableCell>
        <LeadStatusBadge status={lead.status} />
      </TableCell>
      <TableCell className="tabular whitespace-nowrap">
        {lead.value != null ? (
          fmt.currency(lead.value, lead.currency)
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </TableCell>
      <TableCell className="text-fg-muted">{t(LEAD_SOURCE_LABELS[lead.source])}</TableCell>
      <TableCell>
        <UserChip user={lead.assignee} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-fg-muted tabular">
        <time dateTime={lead.updatedAt} title={fmt.dateTime(new Date(lead.updatedAt), 'long')}>
          {fmt.relative(new Date(lead.updatedAt))}
        </time>
      </TableCell>
    </TableRow>
  );
}
