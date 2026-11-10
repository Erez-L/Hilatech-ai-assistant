'use client';

import * as React from 'react';
import Link from 'next/link';
import { isSameDay, isToday, isYesterday } from 'date-fns';
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
import { useT, useFormat, type T } from '@/i18n/provider';
import type { Formatter } from '@/i18n/format';

export function ConversationThread({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack?: () => void;
}) {
  const t = useT();
  const conversation = useConversation(conversationId);
  return (
    <section
      aria-label={t('conversations.conversation')}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface"
    >
      <QueryState
        query={conversation}
        loading={<ThreadSkeleton onBack={onBack} />}
        errorTitle={t('conversations.thisConversationCouldnTBe')}
      >
        {(data) => <ThreadBody conversation={data} onBack={onBack} />}
      </QueryState>
    </section>
  );
}

function ThreadSkeleton({ onBack }: { onBack?: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col" aria-busy>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {onBack ? (
          <IconButton label={t('conversations.backToList')} className="lg:hidden" onClick={onBack}>
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
        <Skeleton className="ms-auto h-12 w-1/2 rounded-xl" />
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
  const t = useT();
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
          toast.success(
            t('conversations.conversation2', {
              name: t(CONVERSATION_STATUS_LABELS[status]).toLowerCase(),
            }),
          ),
      },
    );
  };

  const title =
    conversation.subject ||
    (conversation.contact
      ? t('conversations.conversationWith', { name: contactName(conversation.contact) })
      : t('conversations.noSubject'));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? (
            <IconButton
              label={t('conversations.backToList')}
              className="lg:hidden"
              onClick={onBack}
            >
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
                <span className="text-fg-subtle">{t('conversations.noContact')}</span>
              )}
              {conversation.lead ? (
                canReadLeads ? (
                  <Link
                    href={`/leads/${conversation.lead.id}`}
                    className="truncate hover:text-fg hover:underline"
                  >
                    {t('conversations.lead', { title: conversation.lead.title })}
                  </Link>
                ) : (
                  <span className="truncate">
                    {t('conversations.lead', { title: conversation.lead.title })}
                  </span>
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
                      c.assignee
                        ? t('conversations.assignedTo', { name: fullName(c.assignee) })
                        : t('conversations.assigneeRemoved'),
                    ),
                },
              )
            }
          />
          {canUpdate ? (
            <NativeSelect
              aria-label={t('common.status')}
              value={conversation.status}
              disabled={update.isPending}
              onChange={(e) => setStatus(e.target.value as ConversationStatus)}
              className="h-8 w-36 text-xs"
            >
              {CONVERSATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(CONVERSATION_STATUS_LABELS[s])}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <ConversationStatusBadge status={conversation.status} />
          )}
          {canUpdate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={t('common.moreActions')} variant="secondary">
                  <MoreHorizontal aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
                  <Link2 aria-hidden />
                  {t('conversations.linkContactOrLead')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {archived ? (
                  <DropdownMenuItem onSelect={() => setStatus('open')}>
                    <RotateCcw aria-hidden />
                    {t('conversations.reopenConversation')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setStatus('archived')}>
                    <Archive aria-hidden />
                    {t('conversations.archiveConversation')}
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
          <Alert tone="neutral" title={t('conversations.thisConversationIsArchived')}>
            <div className="flex flex-wrap items-center gap-3">
              <span>{t('conversations.reopenItToReplyOr')}</span>
              {canUpdate ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={update.isPending}
                  onClick={() => setStatus('open')}
                >
                  {t('conversations.reopen')}
                </Button>
              ) : null}
            </div>
          </Alert>
        </div>
      ) : canUpdate ? (
        <MessageComposer
          sending={send.isPending}
          hint={resolved ? t('conversations.thisConversationIsResolvedReplying') : undefined}
          onSend={async ({ content, role }) => {
            try {
              await send.mutateAsync({ role, content, metadata: {} });
            } catch (error) {
              toast.error(
                isApiError(error) && error.status === 409
                  ? t('conversations.archivedReopenToReply')
                  : getErrorMessage(error),
              );
              throw error;
            }
          }}
        />
      ) : (
        <p className="border-t border-border px-4 py-3 text-center text-xs text-fg-muted">
          {t('conversations.yourRoleCanReadThis')}
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

function dayLabel(date: Date, t: T, fmt: Formatter): string {
  if (isToday(date)) return t('conversations.today');
  if (isYesterday(date)) return t('conversations.yesterday');
  return fmt.dateWithWeekday(date);
}

function MessageList({ conversationId }: { conversationId: string }) {
  const t = useT();
  const fmt = useFormat();
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
      aria-label={t('common.messages')}
    >
      {messages.isPending ? (
        <div className="flex flex-col gap-4" aria-busy>
          <Skeleton className="h-12 w-2/3 rounded-xl" />
          <Skeleton className="ms-auto h-12 w-1/2 rounded-xl" />
          <Skeleton className="h-16 w-3/5 rounded-xl" />
        </div>
      ) : messages.isError ? (
        <div className="m-auto flex flex-col items-center gap-2 text-center text-sm text-fg-muted">
          <span>{getErrorMessage(messages.error)}</span>
          <Button size="sm" variant="secondary" onClick={() => void messages.refetch()}>
            {t('common.tryAgain')}
          </Button>
        </div>
      ) : ordered.length === 0 ? (
        <div className="m-auto">
          <EmptyState
            compact
            icon={<MessageSquare />}
            title={t('conversations.noMessagesYet')}
            description={t('conversations.sendTheFirstReplyOr')}
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
                {t('conversations.loadEarlierMessages')}
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
                    className="flex items-center gap-3 py-1 text-2xs font-medium tracking-wide rtl:tracking-normal text-fg-subtle uppercase"
                    aria-label={dayLabel(new Date(first.createdAt), t, fmt)}
                  >
                    <span className="h-px flex-1 bg-border" aria-hidden />
                    {dayLabel(new Date(first.createdAt), t, fmt)}
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
  const t = useT();
  const fmt = useFormat();
  const { role, author, messages } = group;
  const first = messages[0]!;
  const time = fmt.time(new Date(first.createdAt));

  if (role === 'system') {
    return (
      <li className="flex flex-col items-center gap-1 text-center">
        {messages.map((m) => (
          <p key={m.id} className="max-w-md text-xs text-fg-subtle">
            {m.content}
            <time dateTime={m.createdAt} className="ms-2 tabular">
              {fmt.time(new Date(m.createdAt))}
            </time>
          </p>
        ))}
      </li>
    );
  }

  const mine = role === 'agent';
  const name =
    role === 'assistant'
      ? t('conversations.authorAssistant')
      : role === 'customer'
        ? author
          ? t('conversations.authorCustomerLogged', { name: fullName(author) })
          : t('conversations.authorCustomer')
        : author
          ? fullName(author)
          : t('conversations.authorTeam');

  return (
    <li
      className={cn(
        'flex max-w-[85%] gap-2.5 sm:max-w-[75%]',
        mine ? 'ms-auto flex-row-reverse' : 'me-auto',
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
                ? 'rounded-se-sm bg-accent-soft text-accent-soft-fg'
                : role === 'assistant'
                  ? 'rounded-ss-sm border border-info/20 bg-surface text-fg'
                  : 'rounded-ss-sm border border-border bg-surface text-fg',
            )}
          >
            {m.content}
          </div>
        ))}
      </div>
    </li>
  );
}
