/**
 * CSV utilities shared by the API (upload validation, dry run, exports) and the workers (import execution).
 * RFC 4180 parsing, encoding detection (UTF-8 with/without BOM, UTF-16 with BOM, Windows-1255 fallback for legacy
 * Hebrew Excel files) and formula-injection-safe formatting.
 */

export const UTF8_BOM = '﻿';

export type CsvEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1255';

export interface DecodedCsv {
  text: string;
  encoding: CsvEncoding;
}

/**
 * Decodes an uploaded CSV. A BOM decides (UTF-8 / UTF-16). Without BOM the bytes are decoded as strict UTF-8; if
 * that fails (invalid sequences) the file is assumed to be Windows-1255, what Excel in Hebrew locales writes for
 * "CSV (comma delimited)". The BOM is removed from the returned text.
 */
export function decodeCsvBuffer(input: Uint8Array): DecodedCsv {
  const b = input;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    const body = b.subarray(2);
    const swapped = new Uint8Array(body.length - (body.length % 2));
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i] = body[i + 1] as number;
      swapped[i + 1] = body[i] as number;
    }
    return { text: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1255').decode(b), encoding: 'windows-1255' };
  }
}

const DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof DELIMITERS)[number];

/** Picks the delimiter that occurs most (outside quotes) in the first non-empty lines. Defaults to a comma. */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 5; i += 1) {
    const ch = text[i] as string;
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      lines += 1;
    } else if (!inQuotes && counts.has(ch)) counts.set(ch, (counts.get(ch) as number) + 1);
  }
  let best: CsvDelimiter = ',';
  let max = 0;
  for (const d of DELIMITERS) {
    const n = counts.get(d) as number;
    if (n > max) {
      max = n;
      best = d;
    }
  }
  return best;
}

export class CsvError extends Error {
  constructor(
    public readonly code: 'unterminated_quote' | 'too_many_rows' | 'too_many_columns' | 'empty',
    message: string,
  ) {
    super(message);
    this.name = 'CsvError';
  }
}

export interface ParseCsvOptions {
  delimiter?: string;
  /** Maximum number of rows INCLUDING the header; more rows throws `CsvError('too_many_rows')`. */
  maxRows?: number;
  maxColumns?: number;
}

/**
 * RFC 4180 parser: quoted fields, doubled quotes, delimiters and line breaks inside quotes, CRLF/LF/CR. Fully empty
 * lines are skipped. A leading BOM is ignored.
 */
export function parseCsv(input: string, options: ParseCsvOptions = {}): string[][] {
  const text = input.startsWith(UTF8_BOM) ? input.slice(1) : input;
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const maxColumns = options.maxColumns ?? 200;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
    if (row.length > maxColumns) {
      throw new CsvError('too_many_columns', `More than ${maxColumns} columns`);
    }
  };
  const endRow = (): void => {
    endField();
    if (!row.every((c) => c === '')) {
      rows.push(row);
      if (rows.length > maxRows) throw new CsvError('too_many_rows', `More than ${maxRows} rows`);
    }
    row = [];
  };

  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
    } else if (ch === delimiter) {
      endField();
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      i += 1;
      endRow();
    } else {
      field += ch;
      i += 1;
    }
  }
  if (inQuotes) throw new CsvError('unterminated_quote', 'A quoted field is not closed');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * RFC 4180 cell. Strings starting with `= + - @` (or tab / CR) are prefixed with an apostrophe so a spreadsheet never
 * evaluates exported text as a formula (CSV injection). Numbers pass through untouched.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(
  cells: ReadonlyArray<string | number | boolean | null | undefined>,
): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
): string {
  return csvLine(header) + rows.map(csvLine).join('');
}

/**
 * Reverses the export-side escaping on import: `'=SUM(1)` → `=SUM(1)`, `'+972…` → `+972…`. Text the user really
 * typed with a leading apostrophe followed by a non-formula character is left alone.
 */
export function unescapeFormulaCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}
