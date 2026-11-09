import { DOCUMENT_EXTENSION_MIME, type Document, type DocumentStatus } from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';

/** Client-side hint only; the API enforces its own MAX_UPLOAD_MB and answers 413 when exceeded. */
export const UPLOAD_SIZE_HINT_MB = 25;
export const UPLOAD_SIZE_HINT_BYTES = UPLOAD_SIZE_HINT_MB * 1024 * 1024;

export const ACCEPTED_EXTENSIONS: string[] = Object.keys(DOCUMENT_EXTENSION_MIME);
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',');

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  uploaded: 'Uploaded',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

export const DOCUMENT_STATUS_TONES: Record<DocumentStatus, StatusTone> = {
  uploaded: 'neutral',
  processing: 'info',
  ready: 'success',
  failed: 'danger',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/** Returns a message when the file obviously cannot be processed, otherwise null. */
export function validateUploadFile(
  file: Pick<File, 'name' | 'size'>,
  maxBytes = UPLOAD_SIZE_HINT_BYTES,
): string | null {
  const ext = fileExtension(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return `Unsupported file type${ext ? ` (${ext})` : ''}. Use ${ACCEPTED_EXTENSIONS.join(', ')}.`;
  }
  if (file.size === 0) return 'This file is empty.';
  if (file.size > maxBytes) {
    return `This file is ${formatBytes(file.size)}; the limit is about ${formatBytes(maxBytes)}.`;
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
