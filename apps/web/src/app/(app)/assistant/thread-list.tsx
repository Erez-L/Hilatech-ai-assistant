'use client';

import * as React from 'react';
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
import { useT, useFormat, type T } from '@/i18n/provider';

export const threadTitle = (thread: Pick<AssistantThread, 'title'>, t: T) =>
  thread.title?.trim() || t('assistant.newThread');

export function ThreadList({
  selectedId,
  onSelect,
  onNew,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
}) {
  const fmt = useFormat();
  const t = useT();
  const [search, setSearch] = React.useState('');
  const threads = useAssistantThreads({ page: 1, pageSize: 100 });
  const rename = useUpdateAssistantThread();
  const remove = useDeleteAssistantThread();
  const [renaming, setRenaming] = React.useState<AssistantThread | null>(null);
  const [deleting, setDeleting] = React.useState<AssistantThread | null>(null);

  // The API has no thread search; filter the loaded page by title.
  const items = (threads.data?.data ?? []).filter((thread) =>
    threadTitle(thread, t).toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <div className="border-b border-border px-3 py-2.5">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={t('assistant.searchThreads')}
          aria-label={t('assistant.searchThreads')}
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
              {t('common.tryAgain')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={<MessageSquare />}
            title={search ? t('assistant.noThreadsMatch') : t('assistant.noThreadsYet')}
            description={
              search ? t('assistant.tryADifferentSearch') : t('assistant.startAThreadToAsk')
            }
            action={
              search ? undefined : (
                <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={onNew}>
                  {t('assistant.newThread')}
                </Button>
              )
            }
            className="py-14"
          />
        ) : (
          <ul className="divide-y divide-border" aria-label={t('assistant.threads')}>
            {items.map((thread) => {
              const selected = thread.id === selectedId;
              const when = thread.lastMessageAt ?? thread.updatedAt;
              return (
                <li
                  key={thread.id}
                  className={cn('group flex items-center', selected && 'bg-accent-soft/60')}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(thread.id)}
                    aria-current={selected ? 'true' : undefined}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 text-start hover:bg-surface-muted/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  >
                    <span
                      className={cn('truncate text-sm', selected ? 'font-semibold' : 'font-medium')}
                    >
                      {threadTitle(thread, t)}
                    </span>
                    <span className="text-2xs text-fg-subtle tabular">
                      {thread.messageCount}{' '}
                      {thread.messageCount === 1 ? t('assistant.message') : t('assistant.messages')}{' '}
                      · {fmt.relative(new Date(when))}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        label={t('assistant.actionsFor', { threadTitle: threadTitle(thread, t) })}
                        size="sm"
                        className="me-2"
                      >
                        <MoreHorizontal aria-hidden />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onSelect={() => setRenaming(thread)}>
                        <Pencil aria-hidden />
                        {t('assistant.rename')}
                      </DropdownMenuItem>
                      <DropdownMenuItem tone="danger" onSelect={() => setDeleting(thread)}>
                        <Trash2 aria-hidden />
                        {t('common.delete')}
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
        title={t('assistant.deleteThisThread')}
        description={t('assistant.theThreadAndAllOf')}
        confirmLabel={t('assistant.deleteThread')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              if (deleting.id === selectedId) onSelect(null);
              toast.success(t('assistant.threadDeleted'));
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
  const t = useT();
  const [title, setTitle] = React.useState(thread.title ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSave(title.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('assistant.renameThread')}</DialogTitle>
      </DialogHeader>
      <DialogBody className="pb-2">
        <Input
          aria-label={t('assistant.threadTitle')}
          value={title}
          maxLength={200}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={pending} disabled={!title.trim()}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
