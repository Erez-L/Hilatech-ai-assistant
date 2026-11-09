import { normaliseText } from './chunking';

/** Machine-readable reason a document could not be turned into text. */
export type ExtractionErrorCode =
  'unsupported_type' | 'invalid_encoding' | 'invalid_content' | 'empty' | 'too_large';

/** A permanent, user-explainable extraction failure (retrying cannot help). */
export class DocumentExtractionError extends Error {
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentExtractionError';
  }
}

/** Page-aware PDF text extraction supplied by the host (the workers use `pdf-parse`). */
export type PdfTextExtractor = (data: Buffer) => Promise<{ pages: string[] }>;

export interface ExtractedDocument {
  /** Normalised plain text (`normaliseText` applied; chunk offsets refer to this string). */
  text: string;
  pageCount: number | null;
  /** Start offsets of each non-empty page inside `text` (PDF only). */
  pages: Array<{ page: number; start: number }>;
}

export interface ExtractInput {
  data: Buffer;
  mimeType: string;
  fileName?: string;
  pdf?: PdfTextExtractor | null;
}

/** Hard ceiling on extracted text; larger documents are rejected instead of exhausting memory. */
export const MAX_EXTRACTED_CHARS = 5_000_000;

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  copy: '©',
  laquo: '«',
  raquo: '»',
};

function decodeUtf8(data: Buffer): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    throw new DocumentExtractionError(
      'invalid_encoding',
      'The file is not valid UTF-8 text. Re-save it as UTF-8 and upload it again.',
    );
  }
}

export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(p|div|section|article|header|footer|main|aside|ul|ol|table|blockquote|pre)\s*>/gi,
      '\n\n',
    )
    .replace(/<\/(h[1-6])\s*>/gi, '\n\n')
    .replace(/<\/(li|tr|dt|dd)\s*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, ' | ')
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n\n${'#'.repeat(Number(level))} `);
  const stripped = withBreaks.replace(/<[^>]*>/g, '');
  return stripped.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** RFC 4180-style parser (quoted fields, escaped quotes, embedded newlines). */
export function parseCsv(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ',';
}

/** One block per data row: `Header: value` lines, so a row stays together when chunked. */
export function csvToText(input: string): string {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const rows = parseCsv(input, detectDelimiter(firstLine));
  if (rows.length === 0) return '';
  const header = (rows[0] ?? []).map((h, i) => h.trim() || `column_${i + 1}`);
  if (rows.length === 1) return header.join(', ');
  return rows
    .slice(1)
    .map((cells) =>
      header
        .map((name, i) => ({ name, value: (cells[i] ?? '').trim() }))
        .filter((c) => c.value !== '')
        .map((c) => `${c.name}: ${c.value}`)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n');
}

/** Flattens JSON into `path: value` lines; array items and top-level keys become separate blocks. */
export function jsonToText(value: unknown): string {
  const lines: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, path ? `${path}[${i}]` : `[${i}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, path ? `${path}.${key}` : key);
      }
      return;
    }
    lines.push(`${path || 'value'}: ${String(node)}`);
  };
  const blocks: string[] = [];
  const top = Array.isArray(value)
    ? value.map((item, i) => [`[${i}]`, item] as const)
    : value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>)
      : [['', value] as const];
  for (const [key, child] of top) {
    lines.length = 0;
    walk(child, key);
    if (lines.length > 0) blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * Text extraction for the supported upload types. Built-ins handle text, markdown, csv, json and html;
 * PDFs need a host-provided `pdf` extractor, otherwise the document is rejected with a clear message.
 */
export async function extractText(input: ExtractInput): Promise<ExtractedDocument> {
  const mime = input.mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  let raw: string;
  let pageCount: number | null = null;
  const pages: ExtractedDocument['pages'] = [];

  switch (mime) {
    case 'text/plain':
    case 'text/markdown':
      raw = decodeUtf8(input.data);
      break;
    case 'text/csv':
      raw = csvToText(decodeUtf8(input.data));
      break;
    case 'text/html':
      raw = htmlToText(decodeUtf8(input.data));
      break;
    case 'application/json': {
      const text = decodeUtf8(input.data);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new DocumentExtractionError(
          'invalid_content',
          `The file is not valid JSON (${error instanceof Error ? error.message : 'parse error'}).`,
        );
      }
      raw = jsonToText(parsed);
      break;
    }
    case 'application/pdf': {
      if (!input.pdf) {
        throw new DocumentExtractionError(
          'unsupported_type',
          'PDF text extraction is not available on this server.',
        );
      }
      let extracted: { pages: string[] };
      try {
        extracted = await input.pdf(input.data);
      } catch (error) {
        throw new DocumentExtractionError(
          'invalid_content',
          `The PDF could not be read (${error instanceof Error ? error.message.slice(0, 200) : 'parse error'}).`,
        );
      }
      pageCount = extracted.pages.length;
      let joined = '';
      extracted.pages.forEach((pageText, i) => {
        const normalised = normaliseText(pageText);
        if (!normalised) return;
        if (joined) joined += '\n\n';
        pages.push({ page: i + 1, start: joined.length });
        joined += normalised;
      });
      raw = joined;
      break;
    }
    default:
      throw new DocumentExtractionError('unsupported_type', `Unsupported document type "${mime}".`);
  }

  const text = normaliseText(raw);
  if (text.length > MAX_EXTRACTED_CHARS) {
    throw new DocumentExtractionError(
      'too_large',
      `The document contains too much text (${text.length.toLocaleString('en-US')} characters, maximum ${MAX_EXTRACTED_CHARS.toLocaleString('en-US')}).`,
    );
  }
  if (!text) {
    throw new DocumentExtractionError(
      'empty',
      mime === 'application/pdf'
        ? 'No extractable text found (scanned or image-only PDF?). OCR is not supported.'
        : 'The document contains no text.',
    );
  }
  return { text, pageCount, pages };
}
