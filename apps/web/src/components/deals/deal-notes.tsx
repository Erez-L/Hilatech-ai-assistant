'use client';

import * as React from 'react';
import { StickyNote, Trash2 } from 'lucide-react';
import {
  AutosizeTextarea,
  Avatar,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  IconButton,
  Skeleton,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useAddDealNote, useDealNotes, useRemoveDealNote } from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import { fullName } from '@/lib/crm';
import { Permission } from '@hilatech/contracts';
import { QueryState } from '@/components/common/query-state';
import { useFormat, useT } from '@/i18n/provider';

const MAX_NOTE = 5000;

export function DealNotes({ dealId, canWrite }: { dealId: string; canWrite: boolean }) {
  const t = useT();
  const fmt = useFormat();
  const notes = useDealNotes(dealId);
  const add = useAddDealNote();
  const remove = useRemoveDealNote();
  const canDelete = useCan(Permission.DEALS_DELETE);
  const me = useSession((s) => s.user);
  const [draft, setDraft] = React.useState('');

  const submit = () => {
    const body = draft.trim();
    if (!body || add.isPending) return;
    add.mutate(
      { id: dealId, body },
      {
        onSuccess: () => setDraft(''),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('common.notes')}</CardTitle>
        <CardDescription>{t('leads.internalContextForTheTeam')}</CardDescription>
      </CardHeader>
      {canWrite ? (
        <form
          className="flex flex-col gap-2 border-b border-border px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <AutosizeTextarea
            aria-label={t('leads.newNote')}
            placeholder={t('leads.addANotePressCtrl')}
            minRows={2}
            maxRows={10}
            maxLength={MAX_NOTE}
            dir="auto"
            value={draft}
            disabled={add.isPending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex justify-end">
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
          loading={<Skeleton className="m-5 h-16" />}
          isEmpty={(r) => r.data.length === 0}
          empty={<EmptyState compact icon={<StickyNote />} title={t('leads.noNotesYet')} description={canWrite ? t('leads.writeDownWhatYouLearned') : t('leads.notesAddedByTheTeam')} />}
        >
          {(r) => (
            <ul className="divide-y divide-border">
              {r.data.map((note) => (
                <li key={note.id} className="flex gap-3 px-5 py-4" data-testid="deal-note">
                  <Avatar size="sm" src={note.author?.avatarUrl} firstName={note.author?.firstName} lastName={note.author?.lastName} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{note.author ? fullName(note.author) : t('common.formerMember')}</span>
                      <time dateTime={note.createdAt} className="shrink-0 text-xs text-fg-subtle tabular">
                        {fmt.relative(new Date(note.createdAt))}
                      </time>
                    </div>
                    <p className="text-sm whitespace-pre-wrap" dir="auto">
                      {note.body}
                    </p>
                  </div>
                  {(note.authorId === me?.id && canWrite) || canDelete ? (
                    <IconButton
                      label={t('leads.deleteNote')}
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        remove.mutate(
                          { id: dealId, noteId: note.id },
                          {
                            onSuccess: () => toast.success(t('leads.noteDeleted')),
                            onError: (e) => toast.error(getErrorMessage(e)),
                          },
                        )
                      }
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
