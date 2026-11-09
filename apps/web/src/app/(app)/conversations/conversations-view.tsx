'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FilterX, MessageSquare, Plus, SlidersHorizontal } from 'lucide-react';
import { Permission, type ConversationChannel, type ConversationStatus } from '@hilatech/contracts';
import {
  Button,
  EmptyState,
  IconButton,
  Label,
  NativeSelect,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  cn,
} from '@hilatech/ui';
import { useConversations, useMembers } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_STATUSES,
  CONVERSATION_STATUS_LABELS,
  fullName,
} from '@/lib/crm';
import { PermissionGate } from '@/components/common/permission-gate';
import { NewConversationDialog } from '@/components/crm/new-conversation-dialog';
import { ConversationList } from './conversation-list';
import { ConversationThread } from './conversation-thread';

const PAGE_SIZE = 25;
const ME = '__me__';

/**
 * Inbox: list on the left, thread on the right. The selected conversation lives in the URL
 * (`?c=<id>`) so threads are linkable from notifications, leads and contacts. Below `lg` the two
 * panes stack: the list is shown until a thread is chosen, then the thread with a back button.
 */
export function ConversationsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const me = useSession((s) => s.user);
  const canCreate = useCan(Permission.CONVERSATIONS_CREATE);
  const canReadMembers = useCan(Permission.MEMBERS_READ);

  const selectedId = searchParams.get('c');
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<ConversationStatus | ''>(
    (searchParams.get('status') as ConversationStatus | null) ?? '',
  );
  const [channel, setChannel] = React.useState<ConversationChannel | ''>('');
  const [assignee, setAssignee] = React.useState(searchParams.get('assignee') ?? '');
  const [createOpen, setCreateOpen] = React.useState(searchParams.get('new') === '1');

  const assigneeId = assignee === ME ? me?.id : assignee || undefined;
  const conversations = useConversations(
    {
      page,
      pageSize: PAGE_SIZE,
      search: search || undefined,
      status: status || undefined,
      channel: channel || undefined,
      assigneeId,
      sortBy: 'lastMessageAt',
      sortOrder: 'desc',
    },
    { refetchInterval: 30_000 },
  );
  const members = useMembers({ page: 1, pageSize: 100 });

  const hasFilters = !!(search || status || channel || assignee);
  const activeFilterCount = [status, channel, assignee].filter(Boolean).length;
  const reset = () => {
    setSearch('');
    setStatus('');
    setChannel('');
    setAssignee('');
    setPage(1);
  };

  const select = React.useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set('c', id);
      else params.delete('c');
      params.delete('new');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <PermissionGate anyOf={[Permission.CONVERSATIONS_READ]}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Conversations"
          description="Every exchange with customers — by the team and the assistant."
          actions={
            canCreate ? (
              <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreateOpen(true)}>
                New conversation
              </Button>
            ) : undefined
          }
        />

        <div className="grid h-[calc(100dvh-13.5rem)] min-h-[32rem] overflow-hidden rounded-lg border border-border bg-surface shadow-xs lg:grid-cols-[22rem_minmax(0,1fr)]">
          {/* List pane */}
          <aside
            aria-label="Conversation list"
            className={cn(
              'flex min-h-0 flex-col border-border lg:border-r',
              selectedId ? 'hidden lg:flex' : 'flex',
            )}
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <SearchInput
                value={search}
                onValueChange={(v) => {
                  setSearch(v);
                  setPage(1);
                }}
                placeholder="Search subject or contact"
                aria-label="Search conversations"
                className="flex-1"
              />
              <Popover>
                <PopoverTrigger asChild>
                  <IconButton
                    label={
                      activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'
                    }
                    variant="secondary"
                    className="relative"
                  >
                    <SlidersHorizontal aria-hidden />
                    {activeFilterCount > 0 ? (
                      <span
                        aria-hidden
                        className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[0.625rem] font-semibold text-accent-fg"
                      >
                        {activeFilterCount}
                      </span>
                    ) : null}
                  </IconButton>
                </PopoverTrigger>
                <PopoverContent align="end" className="flex w-72 flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="conv-filter-status">Status</Label>
                    <NativeSelect
                      id="conv-filter-status"
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value as ConversationStatus | '');
                        setPage(1);
                      }}
                    >
                      <option value="">All statuses</option>
                      {CONVERSATION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {CONVERSATION_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="conv-filter-channel">Channel</Label>
                    <NativeSelect
                      id="conv-filter-channel"
                      value={channel}
                      onChange={(e) => {
                        setChannel(e.target.value as ConversationChannel | '');
                        setPage(1);
                      }}
                    >
                      <option value="">All channels</option>
                      {CONVERSATION_CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {CONVERSATION_CHANNEL_LABELS[c]}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="conv-filter-assignee">Assignee</Label>
                    <NativeSelect
                      id="conv-filter-assignee"
                      value={assignee}
                      onChange={(e) => {
                        setAssignee(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">Anyone</option>
                      {me ? <option value={ME}>Assigned to me</option> : null}
                      {canReadMembers
                        ? (members.data?.data ?? [])
                            .filter((m) => m.userId !== me?.id)
                            .map((m) => (
                              <option key={m.userId} value={m.userId}>
                                {fullName(m.user)}
                              </option>
                            ))
                        : null}
                    </NativeSelect>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={reset}
                    disabled={!hasFilters}
                    leadingIcon={<FilterX aria-hidden />}
                    className="self-end"
                  >
                    Clear filters
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
            <ConversationList
              query={conversations}
              selectedId={selectedId}
              onSelect={select}
              hasFilters={hasFilters}
              onClear={reset}
              canCreate={canCreate}
              onCreate={() => setCreateOpen(true)}
              page={page}
              onPageChange={setPage}
            />
          </aside>

          {/* Thread pane */}
          <div className={cn('min-h-0 min-w-0 flex-col', selectedId ? 'flex' : 'hidden lg:flex')}>
            {selectedId ? (
              <ConversationThread
                key={selectedId}
                conversationId={selectedId}
                onBack={() => select(null)}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8">
                <EmptyState
                  compact
                  icon={<MessageSquare />}
                  title="Pick a conversation"
                  description="Choose a thread on the left to read and reply."
                  action={
                    canCreate ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        leadingIcon={<Plus aria-hidden />}
                        onClick={() => setCreateOpen(true)}
                      >
                        New conversation
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>
        </div>

        <NewConversationDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(c) => select(c.id)}
        />
      </div>
    </PermissionGate>
  );
}
