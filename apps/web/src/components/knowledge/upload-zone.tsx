'use client';

import * as React from 'react';
import { CheckCircle2, CircleAlert, Loader2, UploadCloud, X } from 'lucide-react';
import { Button, IconButton, cn } from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useUploadDocument } from '@/hooks/knowledge';
import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_EXTENSIONS,
  UPLOAD_SIZE_HINT_MB,
  validateUploadFile,
} from '@/lib/knowledge';
import { useT, useFormat } from '@/i18n/provider';

export interface UploadItem {
  id: number;
  name: string;
  size: number;
  state: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

/** Drag-and-drop + button upload; files go up one at a time and server errors are shown per file. */
export function UploadZone({
  baseId,
  onNotConfigured,
}: {
  baseId: string;
  /** Called when the API answers 409 AI_NOT_CONFIGURED so the page can show the setup empty state. */
  onNotConfigured: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const upload = useUploadDocument(baseId);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const nextId = React.useRef(1);

  const patch = (id: number, change: Partial<UploadItem>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...change } : i)));

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const entries = files.map((file) => ({ file, id: nextId.current++ }));
    const initial: UploadItem[] = entries.map(({ file, id }) => {
      const problem = validateUploadFile(file, t, fmt);
      return {
        id,
        name: file.name,
        size: file.size,
        state: problem ? 'error' : 'queued',
        error: problem ?? undefined,
      };
    });
    setItems((list) => [...initial, ...list]);
    for (const { file, id } of entries) {
      if (initial.find((i) => i.id === id)?.state === 'error') continue;
      patch(id, { state: 'uploading' });
      try {
        await upload.mutateAsync(file);
        patch(id, { state: 'done' });
      } catch (error) {
        if (isApiError(error) && error.code === 'AI_NOT_CONFIGURED') {
          patch(id, { state: 'error', error: t('knowledge.aiNotSetUp') });
          onNotConfigured();
          break;
        }
        patch(id, { state: 'error', error: getErrorMessage(error) });
      }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(Array.from(e.dataTransfer.files));
        }}
        data-testid="upload-dropzone"
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
          dragging ? 'border-accent bg-accent-soft' : 'border-border bg-surface/50',
        )}
      >
        <UploadCloud className="size-6 text-fg-muted" aria-hidden />
        <p className="text-sm font-medium">{t('knowledge.dragFilesHereOrChoose')}</p>
        <p className="text-xs text-fg-muted">
          {t('knowledge.uploadHint', {
            types: ACCEPTED_EXTENSIONS.join(' '),
            size: UPLOAD_SIZE_HINT_MB,
          })}
        </p>
        <input
          ref={inputRef}
          id="knowledge-upload-input"
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          aria-label={t('knowledge.chooseFilesToUpload')}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void handleFiles(files);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leadingIcon={<UploadCloud aria-hidden />}
          onClick={() => inputRef.current?.click()}
        >
          {t('knowledge.uploadDocuments')}
        </Button>
      </div>

      {items.length > 0 ? (
        <ul aria-label={t('knowledge.uploads')} className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <span className="mt-0.5" aria-hidden>
                {item.state === 'done' ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : item.state === 'error' ? (
                  <CircleAlert className="size-4 text-danger" />
                ) : (
                  <Loader2 className="size-4 animate-spin text-fg-muted" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {item.name}{' '}
                  <span className="font-normal text-fg-muted">({fmt.bytes(item.size)})</span>
                </p>
                <p
                  className={cn(
                    'text-xs',
                    item.state === 'error' ? 'text-danger' : 'text-fg-muted',
                  )}
                  role={item.state === 'error' ? 'alert' : undefined}
                >
                  {item.state === 'queued' && t('knowledge.waiting')}
                  {item.state === 'uploading' && t('knowledge.uploading')}
                  {item.state === 'done' && t('knowledge.uploadedProcessingInTheBackground')}
                  {item.state === 'error' && item.error}
                </p>
              </div>
              {item.state === 'done' || item.state === 'error' ? (
                <IconButton
                  size="sm"
                  label={t('knowledge.dismiss', { name: item.name })}
                  onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))}
                >
                  <X aria-hidden />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
