'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useDeleteKnowledgeBase, useKnowledgeBase } from '@/hooks/knowledge';
import { useCan } from '@/hooks/use-can';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { BaseDialog } from '@/components/knowledge/base-dialog';
import { DocumentsPanel } from '@/components/knowledge/documents-panel';
import { RetrievalPanel } from '@/components/knowledge/retrieval-panel';
import { ErrorState } from '@hilatech/ui';

export function BaseDetailView({ id }: { id: string }) {
  const router = useRouter();
  const canManage = useCan(Permission.KNOWLEDGE_MANAGE);
  const base = useKnowledgeBase(id);
  const remove = useDeleteKnowledgeBase();
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  return (
    <PermissionGate anyOf={[Permission.KNOWLEDGE_READ]}>
      <div className="flex flex-col gap-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="self-start"
          leadingIcon={<ArrowLeft aria-hidden />}
        >
          <Link href="/knowledge">All knowledge bases</Link>
        </Button>
        {base.isError && isApiError(base.error) && base.error.isNotFound ? (
          <ErrorState
            title="Knowledge base not found"
            message="It may have been deleted, or it belongs to another organization."
          />
        ) : (
          <QueryState
            query={base}
            errorTitle="This knowledge base couldn’t be loaded"
            loading={
              <div
                className="flex flex-col gap-3"
                aria-busy="true"
                aria-label="Loading knowledge base"
              >
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-96" />
                <Skeleton className="h-40" />
              </div>
            }
          >
            {(b) => (
              <>
                <PageHeader
                  title={b.name}
                  description={b.description || undefined}
                  actions={
                    canManage ? (
                      <>
                        <Button
                          variant="secondary"
                          leadingIcon={<Pencil aria-hidden />}
                          onClick={() => setEditing(true)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="secondary"
                          leadingIcon={<Trash2 aria-hidden />}
                          onClick={() => setDeleting(true)}
                        >
                          Delete
                        </Button>
                      </>
                    ) : null
                  }
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className="tabular">
                      {b.documentCount} {b.documentCount === 1 ? 'document' : 'documents'}
                    </Badge>
                    <Badge variant="outline" className="tabular">
                      {b.chunkCount} {b.chunkCount === 1 ? 'chunk' : 'chunks'}
                    </Badge>
                    <Badge variant="outline">
                      Embeddings: {b.embeddingModel ?? 'organization default'}
                    </Badge>
                  </div>
                </PageHeader>

                <Tabs defaultValue="documents">
                  <TabsList aria-label="Knowledge base sections">
                    <TabsTrigger value="documents">Documents</TabsTrigger>
                    <TabsTrigger value="search">Retrieval test</TabsTrigger>
                  </TabsList>
                  <TabsContent value="documents">
                    <DocumentsPanel baseId={b.id} />
                  </TabsContent>
                  <TabsContent value="search">
                    <RetrievalPanel baseId={b.id} bases={[b]} idPrefix="base-retrieval" />
                  </TabsContent>
                </Tabs>

                {editing ? (
                  <BaseDialog base={b} open onOpenChange={(open) => !open && setEditing(false)} />
                ) : null}
                <ConfirmDialog
                  open={deleting}
                  onOpenChange={setDeleting}
                  title="Delete this knowledge base?"
                  description={`“${b.name}” with its ${b.documentCount} documents, ${b.chunkCount} chunks and stored files will be removed. This can’t be undone.`}
                  confirmLabel="Delete knowledge base"
                  tone="danger"
                  loading={remove.isPending}
                  onConfirm={async () => {
                    try {
                      await remove.mutateAsync(b.id);
                      toast.success(`Knowledge base “${b.name}” deleted`);
                      router.replace('/knowledge');
                    } catch (e) {
                      toast.error(getErrorMessage(e));
                    }
                  }}
                />
              </>
            )}
          </QueryState>
        )}
      </div>
    </PermissionGate>
  );
}
