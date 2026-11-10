import { describe, expect, it } from 'vitest';
import {
  IMPORT_FIELDS,
  emailKey,
  nameKey,
  normalizeCompanyRow,
  normalizeContactRow,
  normalizeDealRow,
  normalizeHeader,
  normalizeLeadRow,
  parseCurrency,
  parseDateValue,
  parseDomain,
  parseEmail,
  parseMoney,
  parseTagList,
  phoneKey,
  rowToFields,
  suggestMapping,
  validateMapping,
} from '../import-export';

describe('value parsers', () => {
  it('parses money in several formats', () => {
    expect(parseMoney('1200')).toEqual({ value: 1200 });
    expect(parseMoney('₪1,200.50')).toEqual({ value: 1200.5 });
    expect(parseMoney('1.200,50')).toEqual({ value: 1200.5 });
    expect(parseMoney('12 000')).toEqual({ value: 12000 });
    expect(parseMoney('12,5')).toEqual({ value: 12.5 });
    expect(parseMoney('abc').error).toBeDefined();
    expect(parseMoney('')).toEqual({});
  });
  it('parses ISO and DD/MM/YYYY dates and rejects impossible ones', () => {
    expect(parseDateValue('2026-03-31').value).toBe('2026-03-31T00:00:00.000Z');
    expect(parseDateValue('31/3/2026').value).toBe('2026-03-31T00:00:00.000Z');
    expect(parseDateValue('31.03.2026').value).toBe('2026-03-31T00:00:00.000Z');
    expect(parseDateValue('31/02/2026').error).toBeDefined();
    expect(parseDateValue('yesterday').error).toBeDefined();
  });
  it('parses emails, domains, currency and tags', () => {
    expect(parseEmail('Dana@Example.COM')).toEqual({ value: 'dana@example.com' });
    expect(parseEmail('nope').error).toBeDefined();
    expect(parseDomain('https://www.Example.com/path?x=1')).toEqual({ value: 'example.com' });
    expect(parseDomain('not a domain').error).toBeDefined();
    expect(parseCurrency('₪')).toEqual({ value: 'ILS' });
    expect(parseCurrency('usd')).toEqual({ value: 'USD' });
    expect(parseCurrency('dollars').error).toBeDefined();
    expect(parseTagList('vip; web,vip|חם').value).toEqual(['vip', 'web', 'חם']);
    expect(parseTagList(Array.from({ length: 21 }, (_, i) => `t${i}`).join(';')).error).toBeDefined();
  });
});

describe('duplicate keys', () => {
  it('normalises emails, phones and names', () => {
    expect(emailKey(' Dana@Example.com ')).toBe('dana@example.com');
    expect(emailKey('')).toBeNull();
    expect(phoneKey('050-123-4567')).toBe(phoneKey('+972 50 123 4567'));
    expect(phoneKey('12')).toBeNull();
    expect(nameKey('  ACME   Ltd ')).toBe(nameKey('acme ltd'));
    expect(nameKey('חברה  בע"מ')).toBe('חברה בע"מ');
    expect(nameKey('   ')).toBeNull();
  });
});

describe('column mapping', () => {
  it('suggests a mapping from English and Hebrew headers', () => {
    const m = suggestMapping('contacts', ['שם פרטי', 'שם משפחה', 'אימייל', 'טלפון', 'Company']);
    expect(m.firstName).toBe(0);
    expect(m.lastName).toBe(1);
    expect(m.email).toBe(2);
    expect(m.phone).toBe(3);
    expect(m.company).toBe(4);
  });
  it('maps each column at most once', () => {
    const m = suggestMapping('contacts', ['Email', 'Email address']);
    const used = Object.values(m).filter((v) => v !== null && v !== undefined);
    expect(new Set(used).size).toBe(used.length);
  });
  it('normalises headers', () => {
    expect(normalizeHeader('  First-Name ')).toBe('firstname');
  });
  it('validates mappings', () => {
    expect(validateMapping('contacts', { firstName: 0 }, 3)).toEqual([]);
    expect(validateMapping('contacts', { fullName: 1 }, 3)).toEqual([]);
    expect(validateMapping('contacts', { email: 0 }, 3).join()).toMatch(/First name/);
    expect(validateMapping('contacts', { firstName: 5 }, 3).join()).toMatch(/does not exist/);
    expect(validateMapping('contacts', { bogus: 0, firstName: 0 }, 3).join()).toMatch(/Unknown field/);
    expect(validateMapping('companies', {}, 3).join()).toMatch(/must be mapped/);
  });
  it('declares fields for every entity', () => {
    for (const entity of ['contacts', 'leads', 'companies', 'deals'] as const) {
      expect(IMPORT_FIELDS[entity].length).toBeGreaterThan(0);
    }
  });
});

describe('rowToFields', () => {
  it('trims, drops NULs and unescapes the export-side formula prefix', () => {
    const f = rowToFields('contacts', { firstName: 0, phone: 1, notes: 2 }, [' Dana ', "'+972501234567", "'=SUM(1)"]);
    expect(f.firstName).toBe('Dana');
    expect(f.phone).toBe('+972501234567');
    expect(f.notes).toBe('=SUM(1)');
  });
  it('treats unmapped fields as empty', () => {
    expect(rowToFields('contacts', { firstName: 0 }, ['x']).email).toBe('');
  });
});

describe('row normalisation', () => {
  it('normalises a Hebrew contact and splits a full name', () => {
    const r = normalizeContactRow({ fullName: 'דנה כהן לוי', email: 'DANA@example.com', tags: 'vip;חם' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({ firstName: 'דנה', lastName: 'כהן לוי', email: 'dana@example.com', tags: ['vip', 'חם'] });
    }
  });
  it('reports every problem of a bad contact row', () => {
    const r = normalizeContactRow({ firstName: '', email: 'bad' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.field).sort()).toEqual(['email', 'firstName']);
    }
  });
  it('validates leads, companies and deals', () => {
    expect(normalizeLeadRow({ title: 'Deal', value: '1,000', currency: '₪' }).ok).toBe(true);
    expect(normalizeLeadRow({ title: '', value: 'x' }).ok).toBe(false);
    expect(normalizeCompanyRow({ name: 'Acme', domain: 'https://acme.io' }).ok).toBe(true);
    expect(normalizeCompanyRow({ name: '' }).ok).toBe(false);
    expect(normalizeDealRow({ title: 'Big', value: '5000' }).ok).toBe(true);
    expect(normalizeDealRow({ title: 'Big', expectedCloseAt: '31/02/2026' }).ok).toBe(false);
  });
});
