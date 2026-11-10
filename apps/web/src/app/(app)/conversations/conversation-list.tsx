'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Plus } from 'lucide-react';
import type { ConversationWithRelations } from '@hilatech/contracts';
import { Avatar, Button, EmptyState, Skeleton, cn } from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import type { useConversations } from '@/hooks/queries';
import { CONVERSATION_CHANNEL_LABELS, contactName } from '@/lib/crm';
import { ConversationStatusBadge } from '@/components/crm/badges';
import { ChannelIcon } from '@/components/crm/channel-icon';
import { useT, useFormat } from '@/i18n/provider';

export function ConversationList({
  query,
  selectedId,
  onSelect,
  hasFilters,
  onClear,
  canCreate,
  onCreate,
  page,
  onPageChange,
}: {
  query: ReturnType<typeof useConversations>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasFilters: boolean;
  onClear: () => void;
  canCreate: boolean;
  onCreate: () => void;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const t = useT();
  const totalPages = query.data?.meta.totalPages ?? 1;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {query.isPending ? (
          <ul className="divide-y divide-border" aria-busy>
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex gap-3 px-4 py-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </li>
            ))}
          </ul>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-fg-muted">
            <span>{getErrorMessage(query.error)}</span>
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              {t('common.tryAgain')}
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <EmptyState
            compact
            icon={<MessageSquare />}
            title={
              hasFilters ? t('conversations.noConversationsMatch') : t('common.noConversationsYet')
            }
            description={
              hasFilters
                ? t('conversations.tryDifferentFiltersOrClear')
                : t('conversations.startOneOrWaitFor')
            }
            action={
              hasFilters ? (
                <Button size="sm" variant="secondary" onClick={onClear}>
                  {t('common.clearFilters')}
                </Button>
              ) : canCreate ? (
                <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={onCreate}>
                  {t('common.newConversation')}
                </Button>
              ) : undefined
            }
            className="py-14"
          />
        ) : (
          <ul className="divide-y divide-border" aria-label={t('common.conversations')}>
            {query.data.data.map((c) => (
              <ConversationListItem
                key={c.id}
                conversation={c}
                selected={c.id === selectedId}
                onSelect={() => onSelect(c.id)}
              />
            ))}
          </ul>
        )}
      </div>
      {query.data && totalPages > 1 ? (
        <nav
          aria-label={t('conversations.conversationPages')}
          className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-fg-muted"
        >
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('conversations.previousPage')}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="tabular">{t('conversations.pageOf', { page, totalPages })}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('conversations.nextPage')}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

function ConversationListItem({
  conversation: c,
  selected,
  onSelect,
}: {
  conversation: ConversationWithRelations;
  selected: boolean;
  onSelect: () => void;
}) {
  const fmt = useFormat();
  const t = useT();
  const title = c.subject || (c.contact ? contactName(c.contact) : t('conversations.noSubject'));
  const preview = c.lastMessage
    ? c.lastMessage.role === 'agent'
      ? t('conversations.previewYou', { text: c.lastMessage.content })
      : c.lastMessage.role === 'assistant'
        ? t('conversations.previewAssistant', { text: c.lastMessage.content })
        : c.lastMessage.content
    : t('conversations.noMessagesYet');
  const when = c.lastMessageAt ?? c.updatedAt;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3 text-start transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
          selected ? 'bg-accent-soft/60' : 'hover:bg-surface-muted/70',
        )}
      >
        <span className="relative shrink-0">
          <Avatar
            size="lg"
            firstName={c.contact?.firstName ?? (c.subject ? c.subject.charAt(0) : '?')}
            lastName={c.contact?.lastName ?? ''}
          />
          <span
            className="absolute -end-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border border-surface bg-surface-muted text-fg-muted"
            title={t(CONVERSATION_CHANNEL_LABELS[c.channel])}
          >
            <ChannelIcon channel={c.channel} className="size-2.5" aria-hidden />
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-sm', selected ? 'font-semibold' : 'font-medium')}>
              {title}
            </span>
            <time dateTime={when} className="shrink-0 text-2xs text-fg-subtle tabular">
              {fmt.relative(new Date(when))}
            </time>
          </span>
          {c.subject && c.contact ? (
            <span className="truncate text-xs text-fg-muted">{contactName(c.contact)}</span>
          ) : null}
          <span className="line-clamp-1 text-xs text-fg-muted">{preview}</span>
          <span className="mt-1 flex items-center gap-2">
            <ConversationStatusBadge
              status={c.status}
              className="px-1.5 py-0 text-[0.625rem] leading-4"
            />
            {c.assignee ? (
              <span className="inline-flex items-center gap-1 text-2xs text-fg-subtle">
                <Avatar
                  size="xs"
                  src={c.assignee.avatarUrl}
                  firstName={c.assignee.firstName}
                  lastName={c.assignee.lastName}
                  className="size-4 text-[0.5rem]"
                />
                {c.assignee.firstName}
              </span>
            ) : (
              <span className="text-2xs text-fg-subtle">{t('conversations.unassigned')}</span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
