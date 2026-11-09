import { ErrorCode } from '@hilatech/contracts';

import { AppException } from '../../common/errors/app.exception';
import { contentDisposition } from './knowledge.controller';
import {
  repairFileName,
  sanitizeFileName,
  titleFromFileName,
  validateUpload,
} from './file-validation';

const MAX = 1024 * 1024;
const file = (name: string, mimetype: string, content: string | Buffer) => {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return { originalname: name, mimetype, size: buffer.length, buffer };
};
const rejection = (fn: () => unknown): AppException => {
  try {
    fn();
  } catch (error) {
    return error as AppException;
  }
  throw new Error('expected a rejection');
};

describe('validateUpload', () => {
  it('accepts each supported type and canonicalises the MIME type', () => {
    expect(validateUpload(file('a.txt', 'text/plain', 'hello'), MAX).mimeType).toBe('text/plain');
    expect(validateUpload(file('a.md', 'text/markdown', '# hi'), MAX).mimeType).toBe(
      'text/markdown',
    );
    expect(validateUpload(file('a.csv', 'text/csv', 'a,b\n1,2'), MAX).mimeType).toBe('text/csv');
    expect(validateUpload(file('a.json', 'application/json', '{}'), MAX).mimeType).toBe(
      'application/json',
    );
    expect(
      validateUpload(file('a.html', 'text/html; charset=utf-8', '<p>x</p>'), MAX).mimeType,
    ).toBe('text/html');
    expect(validateUpload(file('a.pdf', 'application/pdf', '%PDF-1.7\n...'), MAX).mimeType).toBe(
      'application/pdf',
    );
  });

  it('infers the type from the extension for generic or aliased declarations', () => {
    expect(validateUpload(file('notes.md', 'application/octet-stream', 'x'), MAX).mimeType).toBe(
      'text/markdown',
    );
    expect(validateUpload(file('notes.md', '', 'x'), MAX).mimeType).toBe('text/markdown');
    expect(validateUpload(file('data.csv', 'application/vnd.ms-excel', 'a,b'), MAX).mimeType).toBe(
      'text/csv',
    );
    expect(validateUpload(file('data.json', 'text/plain', '{}'), MAX).mimeType).toBe(
      'application/json',
    );
    expect(validateUpload(file('PAGE.HTM', 'text/html', '<p/>'), MAX).mimeType).toBe('text/html');
  });

  it('rejects unsupported extensions / types with 415', () => {
    for (const [name, mime] of [
      ['setup.exe', 'application/octet-stream'],
      ['pic.png', 'image/png'],
      ['archive.zip', 'application/zip'],
      ['script.js', 'text/javascript'],
      ['noext', 'text/plain'],
      ['a.txt', 'application/x-msdownload'],
    ] as const) {
      const error = rejection(() => validateUpload(file(name, mime, 'abc'), MAX));
      expect(error.getStatus()).toBe(415);
      expect(error.code).toBe(ErrorCode.UNSUPPORTED_MEDIA_TYPE);
    }
  });

  it('rejects mismatches between extension and declared type, and spoofed content', () => {
    expect(
      rejection(() =>
        validateUpload(file('a.txt', 'application/pdf', '%PDF-1.4'), MAX),
      ).getStatus(),
    ).toBe(415);
    expect(
      rejection(() => validateUpload(file('a.pdf', 'text/plain', '%PDF-1.4'), MAX)).getStatus(),
    ).toBe(415);
    expect(
      rejection(() =>
        validateUpload(file('a.pdf', 'application/pdf', 'plain text'), MAX),
      ).getStatus(),
    ).toBe(415);
    expect(
      rejection(() =>
        validateUpload(file('a.txt', 'text/plain', Buffer.from([65, 0, 66])), MAX),
      ).getStatus(),
    ).toBe(415);
  });

  it('rejects a missing file (400), an empty file (400) and an oversize file (413)', () => {
    expect(rejection(() => validateUpload(undefined, MAX)).code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(rejection(() => validateUpload(file('a.txt', 'text/plain', ''), MAX)).code).toBe(
      ErrorCode.VALIDATION_ERROR,
    );
    const big = rejection(() =>
      validateUpload(file('a.txt', 'text/plain', Buffer.alloc(MAX + 1, 97)), MAX),
    );
    expect(big.getStatus()).toBe(413);
    expect(big.code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
    expect(validateUpload(file('a.txt', 'text/plain', Buffer.alloc(MAX, 97)), MAX).sizeBytes).toBe(
      MAX,
    );
  });
});

describe('file names', () => {
  it('strips paths, control characters, quotes and leading dots', () => {
    expect(sanitizeFileName('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFileName('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('a"b<c>|d:e*f?.txt')).toBe('abcdef.txt');
    expect(sanitizeFileName('\u202Etxt.exe')).toBe('txt.exe');
    expect(sanitizeFileName('.hidden')).toBe('hidden');
    expect(sanitizeFileName('///')).toBe('document');
    expect(sanitizeFileName(`${'x'.repeat(300)}.md`)).toHaveLength(200);
    expect(sanitizeFileName(`${'x'.repeat(300)}.md`).endsWith('.md')).toBe(true);
  });

  it('repairs UTF-8 names that were decoded as latin1', () => {
    const mojibake = Buffer.from('מסמך.txt', 'utf8').toString('latin1');
    expect(repairFileName(mojibake)).toBe('מסמך.txt');
    expect(repairFileName('מסמך.txt')).toBe('מסמך.txt');
    expect(repairFileName('café.txt')).toBe('café.txt');
  });

  it('derives titles and download headers', () => {
    expect(titleFromFileName('Q3 report.final.pdf')).toBe('Q3 report.final');
    expect(titleFromFileName('noext')).toBe('noext');
    expect(contentDisposition('refund policy.txt')).toBe(
      `attachment; filename="refund policy.txt"; filename*=UTF-8''refund%20policy.txt`,
    );
    expect(contentDisposition('מסמך.txt')).toContain(
      `filename*=UTF-8''${encodeURIComponent('מסמך.txt')}`,
    );
    expect(contentDisposition('a"b.txt')).not.toMatch(/filename="[^"]*"[^;]*"/);
  });
});
