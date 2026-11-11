'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Contact as ContactIcon, FilterX, Plus } from 'lucide-react';
import { Permission, type Contact, type ListContactsQuery } from '@hilatech/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
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
import { useContactTags, useContacts, useMembers } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { contactName, fullName } from '@/lib/crm';
import { ExportButton } from '@/components/data-exchange/export-button';
import { ImportButton } from '@/components/data-exchange/import-wizard';
import { PermissionGate } from '@/components/common/permission-gate';
import { ContactDialog } from './contact-dialog';
import { useT, useFormat } from '@/i18n/provider';

const PAGE_SIZE = 20;
type SortKey = ListContactsQuery['sortBy'];

export function ContactsView() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canCreate = useCan(Permission.CONTACTS_CREATE);
  const canReadMembers = useCan(Permission.MEMBERS_READ);

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [tag, setTag] = React.useState('');
  const [ownerId, setOwnerId] = React.useState('');
  const [sort, setSort] = React.useState<SortState<SortKey>>({
    key: 'createdAt',
    direction: 'desc',
  });
  const [createOpen, setCreateOpen] = React.useState(searchParams.get('new') === '1');

  const contacts = useContacts({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    tag: tag || undefined,
    ownerId: ownerId || undefined,
    sortBy: sort.key,
    sortOrder: sort.direction,
  });
  const tags = useContactTags();
  const members = useMembers({ page: 1, pageSize: 100 });
  const ownerName = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.data?.data ?? []) map.set(m.userId, fullName(m.user));
    return (id: string | null) => (id ? (map.get(id) ?? t('audit.formerMember')) : null);
  }, [members.data, t]);

  const hasFilters = !!(search || tag || ownerId);
  const reset = () => {
    setSearch('');
    setTag('');
    setOwnerId('');
    setPage(1);
  };

  const closeCreate = (open: boolean) => {
    setCreateOpen(open);
    if (!open && searchParams.get('new')) router.replace('/contacts');
  };

  return (
    <PermissionGate anyOf={[Permission.CONTACTS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('common.contacts')}
          description={t('contacts.thePeopleAndCompaniesYour')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ImportButton entity="contacts" />
              <ExportButton
                entity="contacts"
                label={t('common.contacts')}
                filters={{
                  search: search || undefined,
                  tag: tag || undefined,
                  ownerId: ownerId || undefined,
                  sortBy: sort.key,
                  sortOrder: sort.direction,
                }}
              />
              {canCreate ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreateOpen(true)}>
                  {t('contacts.newContact')}
                </Button>
              ) : null}
            </div>
          }
        />

        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_auto] lg:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="contacts-search">{t('common.search')}</Label>
                <SearchInput
                  id="contacts-search"
                  value={search}
                  onValueChange={(v) => {
                    setSearch(v);
                    setPage(1);
                  }}
                  placeholder={t('contacts.nameEmailPhoneOrCompany')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="contacts-tag">{t('common.tag')}</Label>
                <NativeSelect
                  id="contacts-tag"
                  value={tag}
                  onChange={(e) => {
                    setTag(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('contacts.allTags')}</option>
                  {(tags.data ?? []).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="contacts-owner">{t('contacts.owner')}</Label>
                <NativeSelect
                  id="contacts-owner"
                  value={ownerId}
                  disabled={!canReadMembers}
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
            <ContactsTable
              query={contacts}
              sort={sort}
              onSortChange={(next) => {
                setSort(next);
                setPage(1);
              }}
              ownerName={ownerName}
              hasFilters={hasFilters}
              onClear={reset}
              canCreate={canCreate}
              onCreate={() => setCreateOpen(true)}
              onOpen={(id) => router.push(`/contacts/${id}`)}
            />
            {contacts.data && contacts.data.meta.total > PAGE_SIZE ? (
              <div className="border-t border-border px-5 py-3">
                <Pagination
                  page={contacts.data.meta.page}
                  pageSize={contacts.data.meta.pageSize}
                  total={contacts.data.meta.total}
                  onPageChange={setPage}
                  itemLabel={t('contacts.contactsLower')}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <ContactDialog
          open={createOpen}
          onOpenChange={closeCreate}
          onCreated={(contact) => router.push(`/contacts/${contact.id}`)}
        />
      </div>
    </PermissionGate>
  );
}

function ContactsTable({
  query,
  sort,
  onSortChange,
  ownerName,
  hasFilters,
  onClear,
  canCreate,
  onCreate,
  onOpen,
}: {
  query: ReturnType<typeof useContacts>;
  sort: SortState<SortKey>;
  onSortChange: (next: SortState<SortKey>) => void;
  ownerName: (id: string | null) => string | null;
  hasFilters: boolean;
  onClear: () => void;
  canCreate: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const columns = 5;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead sortKey="firstName" sort={sort} onSortChange={onSortChange}>
            {t('common.contact')}
          </SortableHead>
          <SortableHead sortKey="company" sort={sort} onSortChange={onSortChange}>
            {t('common.company')}
          </SortableHead>
          <TableHead>{t('common.tags')}</TableHead>
          <TableHead>{t('contacts.owner')}</TableHead>
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
              icon={<ContactIcon />}
              title={
                hasFilters ? t('contacts.noContactsMatchTheseFilters') : t('contacts.noContactsYet')
              }
              description={
                hasFilters
                  ? t('contacts.tryAnotherSearchTermTag')
                  : t('contacts.addThePeopleYouWork')
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={onClear}>
                    {t('common.clearFilters')}
                  </Button>
                ) : canCreate ? (
                  <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={onCreate}>
                    {t('contacts.newContact')}
                  </Button>
                ) : undefined
              }
            />
          </TableEmptyRow>
        ) : (
          query.data.data.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              owner={ownerName(contact.ownerId)}
              onOpen={onOpen}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
}

function ContactRow({
  contact,
  owner,
  onOpen,
}: {
  contact: Contact;
  owner: string | null;
  onOpen: (id: string) => void;
}) {
  const fmt = useFormat();
  return (
    <TableRow
      className="cursor-pointer"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a,button')) return;
        onOpen(contact.id);
      }}
    >
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar firstName={contact.firstName} lastName={contact.lastName} />
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/contacts/${contact.id}`}
              className="truncate font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {contactName(contact)}
            </Link>
            <span className="truncate text-xs text-fg-muted">
              {contact.email ?? contact.phone ?? '—'}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 flex-col">
          <span className="truncate">
            {contact.company ? (
              contact.companyId ? (
                <Link
                  href={`/companies/${contact.companyId}`}
                  dir="auto"
                  className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {contact.company}
                </Link>
              ) : (
                contact.company
              )
            ) : (
              <span className="text-fg-subtle">—</span>
            )}
          </span>
          {contact.jobTitle ? (
            <span className="truncate text-xs text-fg-muted">{contact.jobTitle}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {contact.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {contact.tags.slice(0, 3).map((t) => (
              <Badge key={t} variant="outline" className="px-1.5 py-0 text-[0.625rem] leading-4">
                {t}
              </Badge>
            ))}
            {contact.tags.length > 3 ? (
              <span className="text-2xs text-fg-subtle">+{contact.tags.length - 3}</span>
            ) : null}
          </div>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </TableCell>
      <TableCell className="text-fg-muted">
        {owner ?? <span className="text-fg-subtle">—</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-fg-muted tabular">
        <time
          dateTime={contact.updatedAt}
          title={fmt.dateTime(new Date(contact.updatedAt), 'long')}
        >
          {fmt.relative(new Date(contact.updatedAt))}
        </time>
      </TableCell>
    </TableRow>
  );
}
