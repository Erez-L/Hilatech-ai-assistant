import {
  DOCUMENT_EXTENSION_MIME,
  ErrorCode,
  SUPPORTED_DOCUMENT_MIME_TYPES,
} from '@hilatech/contracts';
import { HttpStatus } from '@nestjs/common';
import path from 'node:path';

import { AppException } from '../../common/errors/app.exception';

export type SupportedMime = (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number];

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ValidatedUpload {
  /** Sanitised file name (no path, no control characters, bounded length). */
  fileName: string;
  mimeType: SupportedMime;
  sizeBytes: number;
  buffer: Buffer;
}

const MAX_FILE_NAME_LENGTH = 200;

/** Declared types that carry no information; the extension decides instead. */
const GENERIC_MIME = new Set(['application/octet-stream', 'binary/octet-stream', '']);

/** Browsers/OSes label the same formats differently; map the common aliases to the canonical type. */
const MIME_ALIASES: Record<string, SupportedMime> = {
  'text/x-markdown': 'text/markdown',
  'application/x-markdown': 'text/markdown',
  'application/csv': 'text/csv',
  'text/x-csv': 'text/csv',
  'application/vnd.ms-excel': 'text/csv',
  'text/json': 'application/json',
  'application/x-pdf': 'application/pdf',
  'application/xhtml+xml': 'text/html',
};

function unsupported(message: string, details?: unknown): AppException {
  return new AppException(
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    ErrorCode.UNSUPPORTED_MEDIA_TYPE,
    message,
    details,
  );
}

/**
 * Multer decodes `filename` as latin1 unless told otherwise; when a UTF-8 name slipped through as
 * latin1 (every char <= 0xFF) re-decode it so Hebrew/Unicode names survive.
 */
export function repairFileName(name: string): string {
  let hasHigh = false;
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code > 0xff) return name; // already real Unicode
    if (code >= 0x80) hasHigh = true;
  }
  if (!hasHigh) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes(String.fromCharCode(0xfffd)) ? name : decoded;
}

/** Strips directories, control/bidi-override characters and over-long names. Never returns an empty name. */
export function sanitizeFileName(raw: string): string {
  const base = repairFileName(raw).replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩"<>|:*?]/g, '')
    .replace(/^\.+/, '')
    .trim();
  if (!cleaned) return 'document';
  if (cleaned.length <= MAX_FILE_NAME_LENGTH) return cleaned;
  const ext = path.extname(cleaned);
  return `${cleaned.slice(0, MAX_FILE_NAME_LENGTH - ext.length)}${ext}`;
}

/** Default document title: the file name without its extension. */
export function titleFromFileName(fileName: string): string {
  const ext = path.extname(fileName);
  const title = (ext ? fileName.slice(0, -ext.length) : fileName).trim();
  return (title || fileName).slice(0, 255);
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  return sample.includes(0);
}

/**
 * Validates an uploaded file before anything is stored:
 *  - non-empty and within `maxBytes` (413 otherwise);
 *  - extension on the allow-list and consistent with the declared MIME type (415 otherwise);
 *  - content sniffing: PDFs must start with `%PDF-`, text formats must not contain NUL bytes.
 * The client-declared MIME type is never trusted on its own.
 */
export function validateUpload(
  file: UploadedFileLike | undefined,
  maxBytes: number,
): ValidatedUpload {
  if (!file) {
    throw AppException.validation('A file is required (multipart field "file")', [
      { path: 'file', message: 'Required', code: 'required' },
    ]);
  }
  const size = file.buffer?.length ?? file.size;
  if (!size) throw AppException.validation('The uploaded file is empty');
  if (size > maxBytes) {
    throw new AppException(
      HttpStatus.PAYLOAD_TOO_LARGE,
      ErrorCode.PAYLOAD_TOO_LARGE,
      `The file exceeds the maximum upload size of ${Math.floor(maxBytes / (1024 * 1024))} MB`,
    );
  }

  const fileName = sanitizeFileName(file.originalname ?? '');
  const extension = path.extname(fileName).toLowerCase();
  const fromExtension = DOCUMENT_EXTENSION_MIME[extension];
  if (!fromExtension) {
    throw unsupported(
      `Unsupported file extension "${extension || '(none)'}". Allowed: ${Object.keys(DOCUMENT_EXTENSION_MIME).join(', ')}`,
      { allowedExtensions: Object.keys(DOCUMENT_EXTENSION_MIME) },
    );
  }

  const declared = (file.mimetype ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  const mimeType: SupportedMime = fromExtension;
  if (!GENERIC_MIME.has(declared)) {
    const canonical = MIME_ALIASES[declared] ?? declared;
    if (!(SUPPORTED_DOCUMENT_MIME_TYPES as readonly string[]).includes(canonical)) {
      throw unsupported(`Unsupported content type "${declared}"`, {
        allowedMimeTypes: SUPPORTED_DOCUMENT_MIME_TYPES,
      });
    }
    // text/plain is what many clients send for any text file (.md, .csv, .json): the extension refines it.
    const refinable = canonical === 'text/plain' && fromExtension !== 'application/pdf';
    if (canonical !== fromExtension && !refinable) {
      throw unsupported(
        `The file extension "${extension}" does not match the content type "${declared}"`,
      );
    }
  }

  if (mimeType === 'application/pdf') {
    if (file.buffer.subarray(0, 1024).indexOf('%PDF-') < 0) {
      throw unsupported('The file is not a valid PDF (missing %PDF- header)');
    }
  } else if (looksBinary(file.buffer)) {
    throw unsupported('The file looks like binary data, not text');
  }
  return { fileName, mimeType, sizeBytes: file.buffer.length, buffer: file.buffer };
}
