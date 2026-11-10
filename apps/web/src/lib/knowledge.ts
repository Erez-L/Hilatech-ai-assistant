import { DOCUMENT_EXTENSION_MIME, type Document, type DocumentStatus } from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';
import { msg, type Msg } from '@/i18n/msg';
import type { Formatter } from '@/i18n/format';
import type { T } from '@/i18n/provider';

/** Client-side hint only; the API enforces its own MAX_UPLOAD_MB and answers 413 when exceeded. */
export const UPLOAD_SIZE_HINT_MB = 25;
export const UPLOAD_SIZE_HINT_BYTES = UPLOAD_SIZE_HINT_MB * 1024 * 1024;

export const ACCEPTED_EXTENSIONS: string[] = Object.keys(DOCUMENT_EXTENSION_MIME);
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',');

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, Msg> = {
  uploaded: msg('knowledge.docStatus.uploaded'),
  processing: msg('knowledge.docStatus.processing'),
  ready: msg('knowledge.docStatus.ready'),
  failed: msg('knowledge.docStatus.failed'),
};

export const DOCUMENT_STATUS_TONES: Record<DocumentStatus, StatusTone> = {
  uploaded: 'neutral',
  processing: 'info',
  ready: 'success',
  failed: 'danger',
};

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/** Returns a message when the file obviously cannot be processed, otherwise null. */
export function validateUploadFile(
  file: Pick<File, 'name' | 'size'>,
  t: T,
  fmt: Formatter,
  maxBytes = UPLOAD_SIZE_HINT_BYTES,
): string | null {
  const ext = fileExtension(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return t('knowledge.unsupportedFileType', {
      ext: ext ? ` (${ext})` : '',
      allowed: ACCEPTED_EXTENSIONS.join(', '),
    });
  }
  if (file.size === 0) return t('knowledge.fileEmpty');
  if (file.size > maxBytes) {
    return t('knowledge.fileTooLarge', { size: fmt.bytes(file.size), limit: fmt.bytes(maxBytes) });
  }
  return null;
}

export function documentNeedsPolling(docs: Pick<Document, 'status'>[]): boolean {
  return docs.some((d) => d.status === 'uploaded' || d.status === 'processing');
}

/** Triggers a browser download for a Blob. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
