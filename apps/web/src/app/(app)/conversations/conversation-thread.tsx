'use client';

import * as React from 'react';
import Link from 'next/link';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';
import {
  Archive,
  ArrowLeft,
  Bot,
  Link2,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
} from 'lucide-react';
import {
  Permission,
  type ConversationStatus,
  type ConversationWithRelations,
  type MessageWithAuthor,
} from '@hilatech/contracts';
import {
  Alert,
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  NativeSelect,
  Skeleton,
  cn,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import {
  useAssignConversation,
  useConversation,
  useMessages,
  useSendMessage,
  useUpdateConversation,
} from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import {
  CONVERSATION_STATUSES,
  CONVERSATION_STATUS_LABELS,
  contactName,
  fullName,
} from '@/lib/crm';
import { QueryState } from '@/components/common/query-state';
import { AssigneeMenu } from '@/components/crm/assignee-menu';
import { ChannelBadge, ConversationStatusBadge } from '@/components/crm/badges';
import { LinkRecordsDialog } from './link-records-dialog';
import { MessageComposer } from './message-composer';

export function ConversationThread({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack?: () => void;
}) {
  const conversation = useConversation(conversationId);
  return (
    <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <QueryState
        query={conversation}
        loading={<ThreadSkeleton onBack={onBack} />}
        errorTitle="This conversation couldn’t be loaded"
      >
        {(data) => <ThreadBody conversation={data} onBack={onBack} />}
      </QueryState>
    </section>
  );
}

function ThreadSkeleton({ onBack }: { onBack?: () => void }) {
  return (
    <div className="flex h-full flex-col" aria-busy>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {onBack ? (
          <IconButton label="Back to list" className="lg:hidden" onClick={onBack}>
            <ArrowLeft aria-hidden />
          </IconButton>
        ) : null}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <Skeleton className="h-12 w-2/3 rounded-xl" />
        <Skeleton className="ml-auto h-12 w-1/2 rounded-xl" />
        <Skeleton className="h-16 w-3/5 rounded-xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThreadBody({
  conversation,
  onBack,
}: {
  conversation: ConversationWithRelations;
  onBack?: () => void;
}) {
  const canUpdate = useCan(Permission.CONVERSATIONS_UPDATE);
  const canAssign = useCan(Permission.CONVERSATIONS_ASSIGN);
  const canReadContacts = useCan(Permission.CONTACTS_READ);
  const canReadLeads = useCan(Permission.LEADS_READ);
  const update = useUpdateConversation();
  const assign = useAssignConversation();
  const send = useSendMessage(conversation.id);
  const [linkOpen, setLinkOpen] = React.useState(false);

  const archived = conversation.status === 'archived';
  const resolved = conversation.status === 'resolved';

  const setStatus = (status: ConversationStatus) => {
    if (status === conversation.status) return;
    update.mutate(
      { id: conversation.id, body: { status } },
      {
        onSuccess: () =>
          toast.success(`Conversation ${CONVERSATION_STATUS_LABELS[status].toLowerCase()}`),
      },
    );
  };

  const title =
    conversation.subject ||
    (conversation.contact
      ? `Conversation with ${contactName(conversation.contact)}`
      : 'No subject');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? (
            <IconButton label="Back to list" className="lg:hidden" onClick={onBack}>
              <ArrowLeft aria-hidden />
            </IconButton>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              <ChannelBadge channel={conversation.channel} />
              {conversation.contact ? (
                canReadContacts ? (
                  <Link
                    href={`/contacts/${conversation.contact.id}`}
                    className="truncate hover:text-fg hover:underline"
                  >
                    {contactName(conversation.contact)}
                  </Link>
                ) : (
                  <span className="truncate">{contactName(conversation.contact)}</span>
                )
              ) : (
                <span className="text-fg-subtle">No contact</span>
              )}
              {conversation.lead ? (
                canReadLeads ? (
                  <Link
                    href={`/leads/${conversation.lead.id}`}
                    className="truncate hover:text-fg hover:underline"
                  >
                    Lead: {conversation.lead.title}
                  </Link>
                ) : (
                  <span className="truncate">Lead: {conversation.lead.title}</span>
                )
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <AssigneeMenu
            size="sm"
            assignee={conversation.assignee}
            canAssign={canAssign}
            canSelfAssign={canUpdate}
            pending={assign.isPending}
            onAssign={(userId) =>
              assign.mutate(
                { id: conversation.id, assigneeId: userId },
                {
                  onSuccess: (c) =>
                    toast.success(
                      c.assignee ? `Assigned to ${fullName(c.assignee)}` : 'Assignee removed',
                    ),
                },
              )
            }
          />
          {canUpdate ? (
            <NativeSelect
              aria-label="Status"
              value={conversation.status}
              disabled={update.isPending}
              onChange={(e) => setStatus(e.target.value as ConversationStatus)}
              className="h-8 w-36 text-xs"
            >
              {CONVERSATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CONVERSATION_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <ConversationStatusBadge status={conversation.status} />
          )}
          {canUpdate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More actions" variant="secondary">
                  <MoreHorizontal aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
                  <Link2 aria-hidden />
                  Link contact or lead
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {archived ? (
                  <DropdownMenuItem onSelect={() => setStatus('open')}>
                    <RotateCcw aria-hidden />
                    Reopen conversation
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setStatus('archived')}>
                    <Archive aria-hidden />
                    Archive conversation
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>

      <MessageList conversationId={conversation.id} />

      {archived ? (
        <div className="border-t border-border px-4 py-3">
          <Alert tone="neutral" title="This conversation is archived">
            <div className="flex flex-wrap items-center gap-3">
              <span>Reopen it to reply or log messages.</span>
              {canUpdate ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={update.isPending}
                  onClick={() => setStatus('open')}
                >
                  Reopen
                </Button>
              ) : null}
            </div>
          </Alert>
        </div>
      ) : canUpdate ? (
        <MessageComposer
          sending={send.isPending}
          hint={resolved ? 'This conversation is resolved — replying reopens it.' : undefined}
          onSend={async ({ content, role }) => {
            try {
              await send.mutateAsync({ role, content, metadata: {} });
            } catch (error) {
              toast.error(
                isApiError(error) && error.status === 409
                  ? 'This conversation is archived. Reopen it to reply.'
                  : getErrorMessage(error),
              );
              throw error;
            }
          }}
        />
      ) : (
        <p className="border-t border-border px-4 py-3 text-center text-xs text-fg-muted">
          Your role can read this conversation but not reply.
        </p>
      )}

      <LinkRecordsDialog open={linkOpen} onOpenChange={setLinkOpen} conversation={conversation} />
    </div>
  );
}

// ---------------------------------------------------------------------------

const GROUP_WINDOW_MS = 5 * 60 * 1000;

interface MessageGroup {
  key: string;
  role: MessageWithAuthor['role'];
  author: MessageWithAuthor['author'];
  authorUserId: string | null;
  messages: MessageWithAuthor[];
}

function groupMessages(messages: MessageWithAuthor[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of messages) {
    const last = groups.at(-1);
    const lastMessage = last?.messages.at(-1);
    if (
      last &&
      lastMessage &&
      last.role === m.role &&
      last.authorUserId === m.authorUserId &&
      m.role !== 'system' &&
      new Date(m.createdAt).getTime() - new Date(lastMessage.createdAt).getTime() < GROUP_WINDOW_MS
    ) {
      last.messages.push(m);
    } else {
      groups.push({
        key: m.id,
        role: m.role,
        author: m.author,
        authorUserId: m.authorUserId,
        messages: [m],
      });
    }
  }
  return groups;
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, d MMMM yyyy');
}

function MessageList({ conversationId }: { conversationId: string }) {
  const messages = useMessages(conversationId, { refetchInterval: 15_000 });
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  const ordered = React.useMemo(() => {
    const flat = (messages.data?.pages ?? []).flatMap((p) => p.data);
    // Pages arrive newest-first (desc); display oldest → newest.
    return [...flat].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [messages.data]);
  const lastId = ordered.at(-1)?.id;

  // Follow new messages when the user is already at the bottom.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lastId, conversationId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadEarlier = async () => {
    const el = scrollRef.current;
    const before = el?.scrollHeight ?? 0;
    await messages.fetchNextPage();
    // Keep the viewport anchored on the message that was at the top.
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - before;
    });
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg/40 px-4 py-4 scrollbar-thin"
      role="log"
      aria-live="polite"
      aria-label="Messages"
    >
      {messages.isPending ? (
        <div className="flex flex-col gap-4" aria-busy>
          <Skeleton className="h-12 w-2/3 rounded-xl" />
          <Skeleton className="ml-auto h-12 w-1/2 rounded-xl" />
          <Skeleton className="h-16 w-3/5 rounded-xl" />
        </div>
      ) : messages.isError ? (
        <div className="m-auto flex flex-col items-center gap-2 text-center text-sm text-fg-muted">
          <span>{getErrorMessage(messages.error)}</span>
          <Button size="sm" variant="secondary" onClick={() => void messages.refetch()}>
            Try again
          </Button>
        </div>
      ) : ordered.length === 0 ? (
        <div className="m-auto">
          <EmptyState
            compact
            icon={<MessageSquare />}
            title="No messages yet"
            description="Send the first reply or log what the customer said."
          />
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {messages.hasNextPage ? (
            <li className="flex justify-center">
              <Button
                size="sm"
                variant="ghost"
                loading={messages.isFetchingNextPage}
                onClick={() => void loadEarlier()}
              >
                Load earlier messages
              </Button>
            </li>
          ) : null}
          {groupMessages(ordered).map((group, index, all) => {
            const first = group.messages[0]!;
            const prev = all[index - 1]?.messages.at(-1);
            const showDay =
              !prev || !isSameDay(new Date(prev.createdAt), new Date(first.createdAt));
            return (
              <React.Fragment key={group.key}>
                {showDay ? (
                  <li
                    className="flex items-center gap-3 py-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase"
                    aria-label={dayLabel(new Date(first.createdAt))}
                  >
                    <span className="h-px flex-1 bg-border" aria-hidden />
                    {dayLabel(new Date(first.createdAt))}
                    <span className="h-px flex-1 bg-border" aria-hidden />
                  </li>
                ) : null}
                <MessageGroupItem group={group} />
              </React.Fragment>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function MessageGroupItem({ group }: { group: MessageGroup }) {
  const { role, author, messages } = group;
  const first = messages[0]!;
  const time = format(new Date(first.createdAt), 'HH:mm');

  if (role === 'system') {
    return (
      <li className="flex flex-col items-center gap-1 text-center">
        {messages.map((m) => (
          <p key={m.id} className="max-w-md text-xs text-fg-subtle">
            {m.content}
            <time dateTime={m.createdAt} className="ml-2 tabular">
              {format(new Date(m.createdAt), 'HH:mm')}
            </time>
          </p>
        ))}
      </li>
    );
  }

  const mine = role === 'agent';
  const name =
    role === 'assistant'
      ? 'Assistant'
      : role === 'customer'
        ? author
          ? `${fullName(author)} (logged)`
          : 'Customer'
        : author
          ? fullName(author)
          : 'Team';

  return (
    <li
      className={cn(
        'flex max-w-[85%] gap-2.5 sm:max-w-[75%]',
        mine ? 'ml-auto flex-row-reverse' : 'mr-auto',
      )}
    >
      {role === 'assistant' ? (
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-info-soft text-info-soft-fg"
          aria-hidden
        >
          <Bot className="size-4" />
        </span>
      ) : (
        <Avatar
          size="sm"
          src={author?.avatarUrl}
          firstName={author?.firstName ?? (role === 'customer' ? 'C' : 'T')}
          lastName={author?.lastName ?? ''}
        />
      )}
      <div className={cn('flex min-w-0 flex-col gap-1', mine ? 'items-end' : 'items-start')}>
        <div className="flex items-baseline gap-2 text-xs text-fg-muted">
          <span className="font-medium text-fg">{name}</span>
          <time dateTime={first.createdAt} className="tabular">
            {time}
          </time>
        </div>
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'rounded-xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-xs',
              mine
                ? 'rounded-tr-sm bg-accent-soft text-accent-soft-fg'
                : role === 'assistant'
                  ? 'rounded-tl-sm border border-info/20 bg-surface text-fg'
                  : 'rounded-tl-sm border border-border bg-surface text-fg',
            )}
          >
            {m.content}
          </div>
        ))}
      </div>
    </li>
  );
}
