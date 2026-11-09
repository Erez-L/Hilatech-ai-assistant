'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, MessageSquare, Plus } from 'lucide-react';
import { Permission, type ContactSummary } from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@hilatech/ui';
import { useConversations } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { CONVERSATION_CHANNEL_LABELS } from '@/lib/crm';
import { QueryState } from '@/components/common/query-state';
import { ConversationStatusBadge } from './badges';
import { ChannelIcon } from './channel-icon';
import { NewConversationDialog } from './new-conversation-dialog';
import { UserChip } from './user-chip';

export interface RelatedConversationsProps {
  /** Filter: conversations linked to this lead (sent as `leadId`) or contact (`contactId`). */
  leadId?: string;
  contactId?: string;
  /** Records to pre-link when starting a new conversation. */
  contact?: ContactSummary | null;
  lead?: { id: string; title: string } | null;
  description?: string;
}

export function RelatedConversations({
  leadId,
  contactId,
  contact,
  lead,
  description = 'Threads linked to this record.',
}: RelatedConversationsProps) {
  const router = useRouter();
  const canRead = useCan(Permission.CONVERSATIONS_READ);
  const canCreate = useCan(Permission.CONVERSATIONS_CREATE);
  const [open, setOpen] = React.useState(false);
  const query = useConversations(
    { leadId, contactId, page: 1, pageSize: 10, sortBy: 'lastMessageAt', sortOrder: 'desc' },
    { enabled: canRead },
  );

  const startButton = canCreate ? (
    <Button
      size="sm"
      variant="secondary"
      leadingIcon={<Plus aria-hidden />}
      onClick={() => setOpen(true)}
    >
      Start conversation
    </Button>
  ) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Conversations</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {startButton}
      </CardHeader>
      <CardContent className="p-0">
        {!canRead ? (
          <EmptyState
            compact
            icon={<MessageSquare />}
            title="Conversations are restricted"
            description="Your role can’t view conversations."
          />
        ) : (
          <QueryState
            query={query}
            compact
            loading={
              <ul className="divide-y divide-border">
                {Array.from({ length: 2 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3">
                    <Skeleton className="size-8 rounded-md" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </li>
                ))}
              </ul>
            }
            isEmpty={(r) => r.data.length === 0}
            empty={
              <EmptyState
                compact
                icon={<MessageSquare />}
                title="No conversations yet"
                description="Start one to keep the whole exchange in one place."
                action={startButton ?? undefined}
              />
            }
          >
            {(r) => (
              <ul className="divide-y divide-border">
                {r.data.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/conversations?c=${c.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                    >
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted"
                        title={CONVERSATION_CHANNEL_LABELS[c.channel]}
                      >
                        <ChannelIcon channel={c.channel} className="size-4" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {c.subject || 'No subject'}
                        </span>
                        <span className="truncate text-xs text-fg-muted">
                          {c.lastMessage?.content ?? `${c.messageCount} messages`}
                        </span>
                      </span>
                      <span className="hidden sm:block">
                        <UserChip user={c.assignee} />
                      </span>
                      <ConversationStatusBadge status={c.status} />
                      <span className="hidden w-20 shrink-0 text-right text-xs text-fg-subtle tabular md:block">
                        {c.lastMessageAt
                          ? formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })
                          : '—'}
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        )}
      </CardContent>
      <NewConversationDialog
        open={open}
        onOpenChange={setOpen}
        contact={contact}
        lead={lead}
        onCreated={(c) => router.push(`/conversations?c=${c.id}`)}
      />
    </Card>
  );
}
