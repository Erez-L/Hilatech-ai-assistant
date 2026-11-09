'use client';

import * as React from 'react';
import type { Document } from '@hilatech/contracts';
import {
  Badge,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Pagination,
  Skeleton,
} from '@hilatech/ui';
import { useDocumentChunks } from '@/hooks/knowledge';
import { QueryState } from '@/components/common/query-state';

/** Lists the extracted text chunks of a document, in order. */
export function ChunkViewer({
  document: doc,
  onClose,
}: {
  document: Pick<Document, 'id' | 'title' | 'chunkCount'>;
  onClose: () => void;
}) {
  const [page, setPage] = React.useState(1);
  const chunks = useDocumentChunks(doc.id, { page });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Chunks — {doc.title}</DialogTitle>
          <DialogDescription>
            The text the search index is built from. Each chunk is embedded separately.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <QueryState
            query={chunks}
            compact
            errorTitle="Chunks couldn’t be loaded"
            loading={
              <div className="flex flex-col gap-2" aria-busy="true">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            }
            isEmpty={(r) => r.data.length === 0}
            empty={
              <EmptyState
                compact
                title="No chunks yet"
                description="Chunks appear once the document has been processed."
              />
            }
          >
            {(r) => (
              <>
                <ol aria-label="Chunks" className="flex flex-col gap-2">
                  {r.data.map((chunk) => (
                    <li key={chunk.id} className="rounded-md border border-border bg-surface p-3">
                      <div className="mb-1.5 flex items-center gap-2">
                        <Badge variant="outline">Chunk {chunk.index + 1}</Badge>
                        <span className="text-xs text-fg-muted tabular">
                          {chunk.tokenCount} tokens
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{chunk.content}</p>
                    </li>
                  ))}
                </ol>
                {r.meta.total > r.meta.pageSize ? (
                  <Pagination
                    page={r.meta.page}
                    pageSize={r.meta.pageSize}
                    total={r.meta.total}
                    onPageChange={setPage}
                    itemLabel="chunks"
                  />
                ) : null}
              </>
            )}
          </QueryState>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
