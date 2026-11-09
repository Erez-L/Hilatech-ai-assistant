'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { FilterX, Plus, Target, X } from 'lucide-react';
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
  formatCurrency,
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
import { PermissionGate } from '@/components/common/permission-gate';
import { LeadStatusBadge } from '@/components/crm/badges';
import { UserChip } from '@/components/crm/user-chip';
import { LeadDialog } from './lead-dialog';

const PAGE_SIZE = 20;
type SortKey = ListLeadsQuery['sortBy'];

export function LeadsView() {
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
          title="Leads"
          description="Every opportunity, from first contact to won or lost."
          actions={
            canCreate ? (
              <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreateOpen(true)}>
                New lead
              </Button>
            ) : undefined
          }
        />

        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] xl:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leads-search">Search</Label>
                <SearchInput
                  id="leads-search"
                  value={search}
                  onValueChange={(v) => {
                    setSearch(v);
                    setPage(1);
                  }}
                  placeholder="Title, contact or description"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leads-status">Stage</Label>
                <NativeSelect
                  id="leads-status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as LeadStatus | '');
                    setPage(1);
                  }}
                >
                  <option value="">All stages</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_STATUS_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leads-source">Source</Label>
                <NativeSelect
                  id="leads-source"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as LeadSource | '');
                    setPage(1);
                  }}
                >
                  <option value="">All sources</option>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_SOURCE_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leads-assignee">Assignee</Label>
                <NativeSelect
                  id="leads-assignee"
                  value={assigneeId}
                  disabled={!canReadMembers}
                  onChange={(e) => {
                    setAssigneeId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Anyone</option>
                  {(members.data?.data ?? []).map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {fullName(m.user)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leads-tag">Tag</Label>
                <Input
                  id="leads-tag"
                  value={tagDraft}
                  list="leads-known-tags"
                  placeholder="Any tag"
                  onChange={(e) => setTagDraft(e.target.value)}
                />
                <datalist id="leads-known-tags">
                  {knownTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              <Button
                variant="ghost"
                onClick={reset}
                disabled={!hasFilters}
                leadingIcon={<FilterX aria-hidden />}
              >
                Clear
              </Button>
            </div>
            {contactId ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <span>Showing leads for</span>
                <Badge variant="accent" className="gap-1.5 pr-1">
                  {contactFilter.data ? contactName(contactFilter.data) : 'one contact'}
                  <button
                    type="button"
                    aria-label="Remove contact filter"
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
                  itemLabel="leads"
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
  const columns = 7;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead sortKey="title" sort={sort} onSortChange={onSortChange}>
            Lead
          </SortableHead>
          <TableHead>Contact</TableHead>
          <TableHead>Stage</TableHead>
          <SortableHead sortKey="value" sort={sort} onSortChange={onSortChange}>
            Value
          </SortableHead>
          <TableHead>Source</TableHead>
          <TableHead>Assignee</TableHead>
          <SortableHead sortKey="updatedAt" sort={sort} onSortChange={onSortChange}>
            Updated
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
                Try again
              </Button>
            </div>
          </TableEmptyRow>
        ) : query.data.data.length === 0 ? (
          <TableEmptyRow colSpan={columns} className="py-4">
            <EmptyState
              compact
              icon={<Target />}
              title={hasFilters ? 'No leads match these filters' : 'No leads yet'}
              description={
                hasFilters
                  ? 'Try a different stage, source or search term.'
                  : 'Add your first lead to start tracking the pipeline.'
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={onClear}>
                    Clear filters
                  </Button>
                ) : canCreate ? (
                  <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={onCreate}>
                    New lead
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
          formatCurrency(lead.value, lead.currency)
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </TableCell>
      <TableCell className="text-fg-muted">{LEAD_SOURCE_LABELS[lead.source]}</TableCell>
      <TableCell>
        <UserChip user={lead.assignee} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-fg-muted tabular">
        <time dateTime={lead.updatedAt} title={format(new Date(lead.updatedAt), 'PPpp')}>
          {formatDistanceToNow(new Date(lead.updatedAt), { addSuffix: true })}
        </time>
      </TableCell>
    </TableRow>
  );
}
