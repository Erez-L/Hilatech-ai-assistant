'use client';

import * as React from 'react';
import { Download, FileText, ListTree, RefreshCw, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Permission, type Document, type DocumentStatus } from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  IconButton,
  NativeSelect,
  Pagination,
  SearchInput,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError, knowledgeApi } from '@/lib/api';
import { useDeleteDocument, useKnowledgeDocuments, useReprocessDocument } from '@/hooks/knowledge';
import { useCan } from '@/hooks/use-can';
import { AiNotConfigured } from '@/components/ai/ai-not-configured';
import { ChunkViewer } from './chunk-viewer';
import { DocumentStatusBadge } from './document-status-badge';
import { UploadZone } from './upload-zone';
import { formatBytes, saveBlob } from '@/lib/knowledge';

const PAGE_SIZE = 20;

export function DocumentsPanel({ baseId }: { baseId: string }) {
  const canManage = useCan(Permission.KNOWLEDGE_MANAGE);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<DocumentStatus | ''>('');
  const [notConfigured, setNotConfigured] = React.useState(false);
  const [chunksFor, setChunksFor] = React.useState<Document | null>(null);
  const [deleting, setDeleting] = React.useState<Document | null>(null);

  const docs = useKnowledgeDocuments(baseId, {
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: status || undefined,
  });
  const reprocess = useReprocessDocument();
  const remove = useDeleteDocument();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const onReprocess = (doc: Document) => {
    setBusyId(doc.id);
    reprocess.mutate(doc.id, {
      onSuccess: () => toast.success(`“${doc.title}” queued for reprocessing`),
      onError: (e) => {
        if (isApiError(e) && e.code === 'AI_NOT_CONFIGURED') setNotConfigured(true);
        else toast.error(getErrorMessage(e));
      },
      onSettled: () => setBusyId(null),
    });
  };

  const onDownload = async (doc: Document) => {
    setBusyId(doc.id);
    try {
      saveBlob(await knowledgeApi.download(doc.id), doc.fileName);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const columns = 6;
  const filtered = !!search || !!status;
  return (
    <div className="flex flex-col gap-4">
      {notConfigured ? <AiNotConfigured /> : null}
      {canManage ? (
        <UploadZone baseId={baseId} onNotConfigured={() => setNotConfigured(true)} />
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onValueChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search documents"
            aria-label="Search documents"
            className="sm:max-w-sm sm:flex-1"
          />
          <div className="sm:w-48">
            <NativeSelect
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as DocumentStatus | '');
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="uploaded">Uploaded</option>
              <option value="processing">Processing</option>
              <option value="ready">Ready</option>
              <option value="failed">Failed</option>
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table aria-label="Documents">
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Chunks</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.isPending ? (
                <TableSkeletonRows columns={columns} rows={4} />
              ) : docs.isError ? (
                <TableEmptyRow colSpan={columns}>
                  <div className="flex flex-col items-center gap-2">
                    <span>{getErrorMessage(docs.error)}</span>
                    <Button variant="secondary" size="sm" onClick={() => void docs.refetch()}>
                      Try again
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : docs.data.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<FileText />}
                    title={filtered ? 'No documents match' : 'No documents yet'}
                    description={
                      filtered
                        ? 'Try a different search or status.'
                        : canManage
                          ? 'Upload a document above to build this knowledge base.'
                          : 'Documents appear here once someone uploads them.'
                    }
                  />
                </TableEmptyRow>
              ) : (
                docs.data.data.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{doc.title}</span>
                        <span className="truncate text-xs text-fg-muted">{doc.fileName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-xs flex-col gap-1">
                        <DocumentStatusBadge status={doc.status} />
                        {doc.status === 'failed' && doc.error ? (
                          <span className="text-xs break-words text-danger">{doc.error}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatBytes(doc.sizeBytes)}
                    </TableCell>
                    <TableCell className="text-right tabular">{doc.chunkCount}</TableCell>
                    <TableCell className="text-fg-muted">
                      {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <IconButton
                          size="sm"
                          label={`View chunks of ${doc.title}`}
                          disabled={doc.chunkCount === 0}
                          onClick={() => setChunksFor(doc)}
                        >
                          <ListTree aria-hidden />
                        </IconButton>
                        <IconButton
                          size="sm"
                          label={`Download ${doc.title}`}
                          disabled={busyId === doc.id}
                          onClick={() => void onDownload(doc)}
                        >
                          <Download aria-hidden />
                        </IconButton>
                        {canManage ? (
                          <>
                            <IconButton
                              size="sm"
                              label={`Reprocess ${doc.title}`}
                              disabled={busyId === doc.id || doc.status === 'processing'}
                              onClick={() => onReprocess(doc)}
                            >
                              <RefreshCw aria-hidden />
                            </IconButton>
                            <IconButton
                              size="sm"
                              label={`Delete ${doc.title}`}
                              onClick={() => setDeleting(doc)}
                            >
                              <Trash2 aria-hidden />
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {docs.data && docs.data.meta.total > PAGE_SIZE ? (
            <div className="border-t border-border px-5 py-3">
              <Pagination
                page={docs.data.meta.page}
                pageSize={docs.data.meta.pageSize}
                total={docs.data.meta.total}
                onPageChange={setPage}
                itemLabel="documents"
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {chunksFor ? <ChunkViewer document={chunksFor} onClose={() => setChunksFor(null)} /> : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this document?"
        description={
          deleting
            ? `“${deleting.title}”, its chunks and the stored file will be removed. This can’t be undone.`
            : undefined
        }
        confirmLabel="Delete document"
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(`“${deleting.title}” deleted`);
            setDeleting(null);
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
    </div>
  );
}
