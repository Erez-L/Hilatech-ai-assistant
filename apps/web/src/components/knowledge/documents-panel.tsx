'use client';

import * as React from 'react';
import { Download, FileText, ListTree, RefreshCw, Trash2 } from 'lucide-react';
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
import { saveBlob } from '@/lib/knowledge';
import { useT, useFormat } from '@/i18n/provider';

const PAGE_SIZE = 20;

export function DocumentsPanel({ baseId }: { baseId: string }) {
  const fmt = useFormat();
  const t = useT();
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
      onSuccess: () => toast.success(t('knowledge.queuedForReprocessing', { title: doc.title })),
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
            placeholder={t('knowledge.searchDocuments')}
            aria-label={t('knowledge.searchDocuments')}
            className="sm:max-w-sm sm:flex-1"
          />
          <div className="sm:w-48">
            <NativeSelect
              aria-label={t('common.filterByStatus')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as DocumentStatus | '');
                setPage(1);
              }}
            >
              <option value="">{t('common.allStatuses')}</option>
              <option value="uploaded">{t('knowledge.uploaded')}</option>
              <option value="processing">{t('knowledge.processing')}</option>
              <option value="ready">{t('knowledge.ready')}</option>
              <option value="failed">{t('common.failed')}</option>
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table aria-label={t('knowledge.documents2')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('knowledge.document2')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-end">{t('knowledge.size')}</TableHead>
                <TableHead className="text-end">{t('knowledge.chunks2')}</TableHead>
                <TableHead>{t('knowledge.uploaded')}</TableHead>
                <TableHead className="text-end">
                  <span className="sr-only">{t('common.actions')}</span>
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
                      {t('common.tryAgain')}
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : docs.data.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<FileText />}
                    title={
                      filtered ? t('knowledge.noDocumentsMatch') : t('knowledge.noDocumentsYet')
                    }
                    description={
                      filtered
                        ? t('knowledge.tryADifferentSearchOr')
                        : canManage
                          ? t('knowledge.uploadADocumentAboveTo')
                          : t('knowledge.documentsAppearHereOnceSomeone')
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
                    <TableCell className="text-end tabular">{fmt.bytes(doc.sizeBytes)}</TableCell>
                    <TableCell className="text-end tabular">{doc.chunkCount}</TableCell>
                    <TableCell className="text-fg-muted">
                      {fmt.relative(new Date(doc.createdAt))}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <IconButton
                          size="sm"
                          label={t('knowledge.viewChunksOf', { title: doc.title })}
                          disabled={doc.chunkCount === 0}
                          onClick={() => setChunksFor(doc)}
                        >
                          <ListTree aria-hidden />
                        </IconButton>
                        <IconButton
                          size="sm"
                          label={t('knowledge.download', { title: doc.title })}
                          disabled={busyId === doc.id}
                          onClick={() => void onDownload(doc)}
                        >
                          <Download aria-hidden />
                        </IconButton>
                        {canManage ? (
                          <>
                            <IconButton
                              size="sm"
                              label={t('knowledge.reprocess', { title: doc.title })}
                              disabled={busyId === doc.id || doc.status === 'processing'}
                              onClick={() => onReprocess(doc)}
                            >
                              <RefreshCw aria-hidden />
                            </IconButton>
                            <IconButton
                              size="sm"
                              label={t('knowledge.delete', { title: doc.title })}
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
        title={t('knowledge.deleteThisDocument')}
        description={
          deleting ? t('knowledge.itsChunksAndTheStored', { title: deleting.title }) : undefined
        }
        confirmLabel={t('knowledge.deleteDocument')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t('knowledge.deleted', { title: deleting.title }));
            setDeleting(null);
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
    </div>
  );
}
