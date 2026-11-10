import { describe, expect, it } from 'vitest';
import {
  CsvError,
  UTF8_BOM,
  csvCell,
  csvLine,
  decodeCsvBuffer,
  detectDelimiter,
  parseCsv,
  toCsv,
  unescapeFormulaCell,
} from '../csv';

describe('decodeCsvBuffer', () => {
  it('strips a UTF-8 BOM and reads Hebrew', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('שם,אימייל\nדנה,d@x.co', 'utf8')]);
    const out = decodeCsvBuffer(bytes);
    expect(out.encoding).toBe('utf-8-bom');
    expect(out.text.startsWith('שם')).toBe(true);
  });
  it('decodes plain UTF-8', () => {
    expect(decodeCsvBuffer(Buffer.from('שלום', 'utf8'))).toEqual({ text: 'שלום', encoding: 'utf-8' });
  });
  it('falls back to Windows-1255 (Excel in Hebrew locales)', () => {
    // "שלום" in cp1255: 0xF9 0xEC 0xE5 0xED
    const out = decodeCsvBuffer(Buffer.from([0xf9, 0xec, 0xe5, 0xed]));
    expect(out.encoding).toBe('windows-1255');
    expect(out.text).toBe('שלום');
  });
  it('decodes UTF-16 LE and BE with BOM', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a,ש', 'utf16le')]);
    expect(decodeCsvBuffer(le)).toEqual({ text: 'a,ש', encoding: 'utf-16le' });
    const body = Buffer.from('a,ש', 'utf16le');
    const be = Buffer.alloc(body.length);
    for (let i = 0; i < body.length; i += 2) {
      be[i] = body[i + 1] as number;
      be[i + 1] = body[i] as number;
    }
    expect(decodeCsvBuffer(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toEqual({ text: 'a,ש', encoding: 'utf-16be' });
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, delimiters and newlines inside quotes', () => {
    const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\n"line1\nline2",z\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['line1\nline2', 'z'],
    ]);
  });
  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('a,b')).toBe(',');
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('ignores a BOM and skips empty lines', () => {
    expect(parseCsv(`${UTF8_BOM}a,b\n\n1,2\n\n`)).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('keeps empty trailing cells', () => {
    expect(parseCsv('a,b,c\n1,,')).toEqual([['a', 'b', 'c'], ['1', '', '']]);
  });
  it('enforces row, column and quote limits', () => {
    expect(() => parseCsv('a\n1\n2\n3', { maxRows: 3 })).toThrowError(CsvError);
    try {
      parseCsv('a\n1\n2\n3', { maxRows: 3 });
    } catch (e) {
      expect((e as CsvError).code).toBe('too_many_rows');
    }
    expect(() => parseCsv('a,b,c', { maxColumns: 2 })).toThrowError(CsvError);
    expect(() => parseCsv('a,"b')).toThrowError(CsvError);
  });
});

describe('export side', () => {
  it('prefixes formula-looking text so spreadsheets never evaluate it', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+972501234567')).toBe("'+972501234567");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell(-5)).toBe('-5'); // real numbers are untouched
    expect(csvCell('normal')).toBe('normal');
    expect(csvCell(null)).toBe('');
  });
  it('quotes cells with commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "x"')).toBe('"say ""x"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvLine(['a', 1, true])).toBe('a,1,true\r\n');
    expect(typeof toCsv).toBe('function');
  });
  it('round-trips through the parser and unescapeFormulaCell', () => {
    const values = ['=1+1', '+972501234567', 'plain', 'שלום, עולם', 'say "hi"', 'multi\nline'];
    const text = csvLine(values);
    const [row] = parseCsv(text);
    expect((row as string[]).map(unescapeFormulaCell)).toEqual(values);
  });
});
