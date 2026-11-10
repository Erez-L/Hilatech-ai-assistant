'use client';

import * as React from 'react';
import Link from 'next/link';
import { BookOpen, FileText, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { Permission, type KnowledgeBase } from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PageHeader,
  Pagination,
  SearchInput,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useDeleteKnowledgeBase, useKnowledgeBases } from '@/hooks/knowledge';
import { useCan } from '@/hooks/use-can';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { BaseDialog } from '@/components/knowledge/base-dialog';
import { RetrievalPanel } from '@/components/knowledge/retrieval-panel';
import { useT, useFormat } from '@/i18n/provider';

const PAGE_SIZE = 12;

export function KnowledgeView() {
  const t = useT();
  const canManage = useCan(Permission.KNOWLEDGE_MANAGE);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<KnowledgeBase | null>(null);
  const [deleting, setDeleting] = React.useState<KnowledgeBase | null>(null);
  const remove = useDeleteKnowledgeBase();
  const bases = useKnowledgeBases({ page, pageSize: PAGE_SIZE, search: search || undefined });
  // All bases (names only) so cross-base search hits can be attributed.
  const allBases = useKnowledgeBases({ page: 1, pageSize: 100 });

  return (
    <PermissionGate anyOf={[Permission.KNOWLEDGE_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('knowledge.knowledge')}
          description={t('knowledge.documentsThatGroundTheAssistant')}
          actions={
            canManage ? (
              <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
                {t('knowledge.newKnowledgeBase')}
              </Button>
            ) : null
          }
        />

        <Tabs defaultValue="bases">
          <TabsList aria-label={t('knowledge.knowledgeSections')}>
            <TabsTrigger value="bases">{t('knowledge.knowledgeBases')}</TabsTrigger>
            <TabsTrigger value="search">{t('knowledge.retrievalTest')}</TabsTrigger>
          </TabsList>

          <TabsContent value="bases" className="flex flex-col gap-4">
            <SearchInput
              value={search}
              onValueChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder={t('knowledge.searchKnowledgeBases')}
              aria-label={t('knowledge.searchKnowledgeBases')}
              className="max-w-sm"
            />
            <QueryState
              query={bases}
              errorTitle={t('knowledge.knowledgeBasesCouldnTBe')}
              loading={
                <div
                  className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
                  aria-busy="true"
                  aria-label={t('knowledge.loadingKnowledgeBases')}
                >
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-36" />
                  ))}
                </div>
              }
              isEmpty={(r) => r.data.length === 0}
              empty={
                <EmptyState
                  icon={<BookOpen />}
                  title={
                    search
                      ? t('knowledge.noKnowledgeBasesMatch')
                      : t('knowledge.noKnowledgeBasesYet')
                  }
                  description={
                    search
                      ? t('common.tryADifferentSearchTerm')
                      : canManage
                        ? t('knowledge.createAKnowledgeBaseThen')
                        : t('knowledge.askSomeoneWithAccessTo')
                  }
                  action={
                    !search && canManage ? (
                      <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
                        {t('knowledge.newKnowledgeBase')}
                      </Button>
                    ) : undefined
                  }
                />
              }
            >
              {(r) => (
                <>
                  <ul
                    aria-label={t('knowledge.knowledgeBases')}
                    className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
                  >
                    {r.data.map((base) => (
                      <li key={base.id}>
                        <BaseCard
                          base={base}
                          canManage={canManage}
                          onEdit={() => setEditing(base)}
                          onDelete={() => setDeleting(base)}
                        />
                      </li>
                    ))}
                  </ul>
                  {r.meta.total > PAGE_SIZE ? (
                    <Pagination
                      page={r.meta.page}
                      pageSize={r.meta.pageSize}
                      total={r.meta.total}
                      onPageChange={setPage}
                      itemLabel="knowledge bases"
                    />
                  ) : null}
                </>
              )}
            </QueryState>
          </TabsContent>

          <TabsContent value="search">
            <RetrievalPanel bases={allBases.data?.data} idPrefix="all-retrieval" />
          </TabsContent>
        </Tabs>

        {creating ? <BaseDialog open onOpenChange={(open) => !open && setCreating(false)} /> : null}
        {editing ? (
          <BaseDialog base={editing} open onOpenChange={(open) => !open && setEditing(null)} />
        ) : null}
        <ConfirmDialog
          open={!!deleting}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t('knowledge.deleteThisKnowledgeBase')}
          description={
            deleting
              ? t('knowledge.withItsDocumentsChunksAnd', {
                  name: deleting.name,
                  documentCount: deleting.documentCount,
                  chunkCount: deleting.chunkCount,
                })
              : undefined
          }
          confirmLabel={t('knowledge.deleteKnowledgeBase')}
          tone="danger"
          loading={remove.isPending}
          onConfirm={async () => {
            if (!deleting) return;
            try {
              await remove.mutateAsync(deleting.id);
              toast.success(t('knowledge.knowledgeBaseDeleted', { name: deleting.name }));
              setDeleting(null);
            } catch (e) {
              toast.error(getErrorMessage(e));
            }
          }}
        />
      </div>
    </PermissionGate>
  );
}

function BaseCard({
  base,
  canManage,
  onEdit,
  onDelete,
}: {
  base: KnowledgeBase;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const fmt = useFormat();
  const t = useT();
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              href={`/knowledge/${base.id}`}
              className="truncate text-base font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {base.name}
            </Link>
            <p className="line-clamp-2 min-h-8 text-sm text-fg-muted">
              {base.description || t('common.noDescription')}
            </p>
          </div>
          {canManage ? (
            <div className="flex shrink-0 gap-1">
              <IconButton size="sm" label={t('common.edit2', { name: base.name })} onClick={onEdit}>
                <Pencil aria-hidden />
              </IconButton>
              <IconButton
                size="sm"
                label={t('common.delete2', { name: base.name })}
                onClick={onDelete}
              >
                <Trash2 aria-hidden />
              </IconButton>
            </div>
          ) : null}
        </div>
        <dl className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          <div className="flex items-center gap-1">
            <FileText className="size-3.5" aria-hidden />
            <dt className="sr-only">{t('knowledge.documents2')}</dt>
            <dd className="tabular">
              {base.documentCount}{' '}
              {base.documentCount === 1 ? t('knowledge.document') : t('knowledge.documents')}
            </dd>
          </div>
          <div className="flex items-center gap-1">
            <Layers className="size-3.5" aria-hidden />
            <dt className="sr-only">{t('knowledge.chunks2')}</dt>
            <dd className="tabular">
              {base.chunkCount}{' '}
              {base.chunkCount === 1 ? t('knowledge.chunk') : t('knowledge.chunks')}
            </dd>
          </div>
          <div>
            <dt className="sr-only">{t('common.updated')}</dt>
            <dd>
              {t('knowledge.updated', {
                formatDistanceToNow: fmt.relative(new Date(base.updatedAt)),
              })}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
