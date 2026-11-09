'use client';

import * as React from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { AssistantThread } from '@hilatech/contracts';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  SearchInput,
  Skeleton,
  cn,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import {
  useAssistantThreads,
  useDeleteAssistantThread,
  useUpdateAssistantThread,
} from '@/hooks/queries';

export const threadTitle = (t: Pick<AssistantThread, 'title'>) => t.title?.trim() || 'New thread';

export function ThreadList({
  selectedId,
  onSelect,
  onNew,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
}) {
  const [search, setSearch] = React.useState('');
  const threads = useAssistantThreads({ page: 1, pageSize: 100 });
  const rename = useUpdateAssistantThread();
  const remove = useDeleteAssistantThread();
  const [renaming, setRenaming] = React.useState<AssistantThread | null>(null);
  const [deleting, setDeleting] = React.useState<AssistantThread | null>(null);

  // The API has no thread search; filter the loaded page by title.
  const items = (threads.data?.data ?? []).filter((t) =>
    threadTitle(t).toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <div className="border-b border-border px-3 py-2.5">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search threads"
          aria-label="Search threads"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {threads.isPending ? (
          <ul className="divide-y divide-border" aria-busy>
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex flex-col gap-2 px-4 py-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))}
          </ul>
        ) : threads.isError ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-fg-muted">
            <span>{getErrorMessage(threads.error)}</span>
            <Button size="sm" variant="secondary" onClick={() => void threads.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={<MessageSquare />}
            title={search ? 'No threads match' : 'No threads yet'}
            description={
              search ? 'Try a different search.' : 'Start a thread to ask the assistant.'
            }
            action={
              search ? undefined : (
                <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={onNew}>
                  New thread
                </Button>
              )
            }
            className="py-14"
          />
        ) : (
          <ul className="divide-y divide-border" aria-label="Threads">
            {items.map((t) => {
              const selected = t.id === selectedId;
              const when = t.lastMessageAt ?? t.updatedAt;
              return (
                <li
                  key={t.id}
                  className={cn('group flex items-center', selected && 'bg-accent-soft/60')}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    aria-current={selected ? 'true' : undefined}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 text-left hover:bg-surface-muted/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  >
                    <span
                      className={cn('truncate text-sm', selected ? 'font-semibold' : 'font-medium')}
                    >
                      {threadTitle(t)}
                    </span>
                    <span className="text-2xs text-fg-subtle tabular">
                      {t.messageCount} {t.messageCount === 1 ? 'message' : 'messages'} ·{' '}
                      {formatDistanceToNowStrict(new Date(when), { addSuffix: true })}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        label={`Actions for ${threadTitle(t)}`}
                        size="sm"
                        className="mr-2"
                      >
                        <MoreHorizontal aria-hidden />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onSelect={() => setRenaming(t)}>
                        <Pencil aria-hidden />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem tone="danger" onSelect={() => setDeleting(t)}>
                        <Trash2 aria-hidden />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <RenameDialog
        thread={renaming}
        pending={rename.isPending}
        onClose={() => setRenaming(null)}
        onSave={(title) =>
          renaming &&
          rename.mutate(
            { id: renaming.id, body: { title } },
            { onSuccess: () => setRenaming(null) },
          )
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this thread?"
        description="The thread and all of its messages are deleted. This cannot be undone."
        confirmLabel="Delete thread"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              if (deleting.id === selectedId) onSelect(null);
              toast.success('Thread deleted');
              setDeleting(null);
            },
          });
        }}
      />
    </>
  );
}

function RenameDialog({
  thread,
  pending,
  onClose,
  onSave,
}: {
  thread: AssistantThread | null;
  pending: boolean;
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  return (
    <Dialog open={!!thread} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        {thread ? (
          <RenameForm
            key={thread.id}
            thread={thread}
            pending={pending}
            onSave={onSave}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  thread,
  pending,
  onSave,
  onClose,
}: {
  thread: AssistantThread;
  pending: boolean;
  onSave: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = React.useState(thread.title ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSave(title.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename thread</DialogTitle>
      </DialogHeader>
      <DialogBody className="pb-2">
        <Input
          aria-label="Thread title"
          value={title}
          maxLength={200}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={!title.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
