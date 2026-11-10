'use client';

import * as React from 'react';
import { StickyNote, Trash2 } from 'lucide-react';
import type { LeadNoteWithAuthor } from '@hilatech/contracts';
import {
  AutosizeTextarea,
  Avatar,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Skeleton,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useAddLeadNote, useDeleteLeadNote, useLeadNotes } from '@/hooks/queries';
import { useSession } from '@/stores/session';
import { fullName } from '@/lib/crm';
import { QueryState } from '@/components/common/query-state';
import { useT, useFormat } from '@/i18n/provider';

const MAX_NOTE = 5000;

export function LeadNotes({ leadId, canWrite }: { leadId: string; canWrite: boolean }) {
  const fmt = useFormat();
  const t = useT();
  const notes = useLeadNotes(leadId, { page: 1, pageSize: 50 });
  const add = useAddLeadNote(leadId);
  const remove = useDeleteLeadNote(leadId);
  const me = useSession((s) => s.user);
  const [draft, setDraft] = React.useState('');
  const [target, setTarget] = React.useState<LeadNoteWithAuthor | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    const body = draft.trim();
    if (!body || add.isPending) return;
    try {
      await add.mutateAsync(body);
      setDraft('');
      textareaRef.current?.focus();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('common.notes')}</CardTitle>
          <CardDescription>{t('leads.internalContextForTheTeam')}</CardDescription>
        </div>
        {notes.data ? (
          <span className="text-xs text-fg-subtle tabular">
            {t('leads.total', { total: notes.data.meta.total })}
          </span>
        ) : null}
      </CardHeader>
      {canWrite ? (
        <form
          className="flex flex-col gap-2 border-b border-border px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <AutosizeTextarea
            ref={textareaRef}
            aria-label={t('leads.newNote')}
            placeholder={t('leads.addANotePressCtrl')}
            minRows={2}
            maxRows={10}
            maxLength={MAX_NOTE}
            value={draft}
            disabled={add.isPending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-fg-subtle tabular">
              {draft.length > MAX_NOTE * 0.8 ? `${draft.length}/${MAX_NOTE}` : ' '}
            </span>
            <Button type="submit" size="sm" loading={add.isPending} disabled={!draft.trim()}>
              {t('leads.addNote')}
            </Button>
          </div>
        </form>
      ) : null}
      <CardContent className="p-0">
        <QueryState
          query={notes}
          compact
          loading={
            <ul className="divide-y divide-border">
              {Array.from({ length: 2 }).map((_, i) => (
                <li key={i} className="flex gap-3 px-5 py-4">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3.5 w-full" />
                  </div>
                </li>
              ))}
            </ul>
          }
          isEmpty={(r) => r.data.length === 0}
          empty={
            <EmptyState
              compact
              icon={<StickyNote />}
              title={t('leads.noNotesYet')}
              description={
                canWrite ? t('leads.writeDownWhatYouLearned') : t('leads.notesAddedByTheTeam')
              }
            />
          }
        >
          {(r) => (
            <ul className="divide-y divide-border">
              {r.data.map((note) => {
                const own = note.authorId === me?.id;
                return (
                  <li key={note.id} className="group flex gap-3 px-5 py-4">
                    <Avatar
                      size="sm"
                      src={note.author?.avatarUrl}
                      firstName={note.author?.firstName}
                      lastName={note.author?.lastName}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium">
                          {note.author ? fullName(note.author) : t('common.formerMember')}
                          {own ? (
                            <span className="ms-1 text-xs text-fg-subtle">{t('common.you')}</span>
                          ) : null}
                        </span>
                        <time
                          dateTime={note.createdAt}
                          title={fmt.dateTime(new Date(note.createdAt), 'long')}
                          className="shrink-0 text-xs text-fg-subtle tabular"
                        >
                          {fmt.relative(new Date(note.createdAt))}
                        </time>
                      </div>
                      <p className="text-sm whitespace-pre-wrap text-fg">{note.body}</p>
                    </div>
                    {own && canWrite ? (
                      <IconButton
                        label={t('leads.deleteNote')}
                        size="sm"
                        variant="danger"
                        className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => setTarget(note)}
                      >
                        <Trash2 aria-hidden />
                      </IconButton>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </CardContent>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t('leads.deleteThisNote')}
        description={t('leads.theNoteIsRemovedFor')}
        confirmLabel={t('leads.deleteNote')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!target) return;
          remove.mutate(target.id, {
            onSuccess: () => {
              toast.success(t('leads.noteDeleted'));
              setTarget(null);
            },
          });
        }}
      />
    </Card>
  );
}
