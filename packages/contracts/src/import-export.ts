import { z } from 'zod';
import { idSchema, paginationQuerySchema, sortOrderSchema, timestampsSchema } from './common';
import { LeadSource, LeadStatus } from './crm';
import { DealStatus } from './deals';
import { TaskPriority, TaskStatus, queryBoolean } from './tasks';

// ---------------------------------------------------------------------------
// CSV import / export: field catalogue, mapping, per-row normalisation and the API schemas.
// Pure and framework-free: the API (dry run), the workers (execution) and the web (mapping UI) share it.
// ---------------------------------------------------------------------------

export const ImportEntity = z.enum(['contacts', 'leads', 'companies', 'deals']);
export type ImportEntity = z.infer<typeof ImportEntity>;

export const ImportStatus = z.enum([
  'uploaded',
  'validated',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type ImportStatus = z.infer<typeof ImportStatus>;

/** What to do with a row that matches an existing record. */
export const DuplicateStrategy = z.enum(['skip', 'update', 'create']);
export type DuplicateStrategy = z.infer<typeof DuplicateStrategy>;

/** Hard ceilings, independent of the plan. */
export const IMPORT_MAX_ROWS = 50_000;
export const IMPORT_MAX_COLUMNS = 100;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_BATCH_SIZE = 200;
export const IMPORT_REPORT_CAP = 1_000;
export const IMPORT_VALIDATION_ROW_CAP = 200;
export const IMPORT_MAX_ACTIVE_JOBS = 2;

/** Rows per import by plan. `enterprise` gets the hard ceiling. */
export const IMPORT_ROW_LIMITS: Record<'free' | 'starter' | 'pro' | 'enterprise', number> = {
  free: 500,
  starter: 5_000,
  pro: 20_000,
  enterprise: IMPORT_MAX_ROWS,
};

// ---------------------------------------------------------------------------
// Field catalogue
// ---------------------------------------------------------------------------

export interface ImportFieldSpec {
  key: string;
  label: string;
  required: boolean;
  /** Extra header names recognised by the automatic mapping (English and Hebrew). */
  aliases: readonly string[];
  hint?: string;
}

const f = (
  key: string,
  label: string,
  aliases: readonly string[] = [],
  required = false,
  hint?: string,
): ImportFieldSpec => ({ key, label, required, aliases, ...(hint ? { hint } : {}) });

export const IMPORT_FIELDS: Record<ImportEntity, readonly ImportFieldSpec[]> = {
  contacts: [
    f(
      'firstName',
      'First name',
      ['first name', 'given name', 'שם פרטי', 'פרטי'],
      true,
      'Or map "Full name"',
    ),
    f('lastName', 'Last name', ['last name', 'surname', 'family name', 'שם משפחה', 'משפחה']),
    f('fullName', 'Full name', ['name', 'contact name', 'שם', 'שם מלא']),
    f('email', 'Email', [
      'e-mail',
      'mail',
      'email address',
      'אימייל',
      'דוא"ל',
      'מייל',
      'דואר אלקטרוני',
    ]),
    f('phone', 'Phone', [
      'mobile',
      'tel',
      'telephone',
      'cell',
      'phone number',
      'טלפון',
      'נייד',
      'סלולרי',
    ]),
    f('company', 'Company', ['organization', 'organisation', 'employer', 'חברה', 'ארגון']),
    f('jobTitle', 'Job title', ['title', 'position', 'role', 'תפקיד']),
    f('tags', 'Tags', ['labels', 'תגיות', 'תגים'], false, 'Separated by ; , or |'),
    f('notes', 'Notes', ['note', 'comments', 'הערות', 'הערה']),
    f('ownerEmail', 'Owner email', ['owner', 'account owner', 'בעלים', 'אחראי']),
  ],
  leads: [
    f('title', 'Title', ['name', 'lead', 'lead name', 'subject', 'כותרת', 'שם הליד', 'ליד'], true),
    f(
      'status',
      'Status',
      ['stage', 'סטטוס', 'שלב'],
      false,
      'new, contacted, qualified, proposal, won, lost',
    ),
    f('source', 'Source', ['origin', 'channel', 'מקור']),
    f('value', 'Value', ['amount', 'deal value', 'ערך', 'סכום']),
    f('currency', 'Currency', ['מטבע']),
    f('contactEmail', 'Contact email', ['email', 'e-mail', 'אימייל', 'מייל']),
    f('contactPhone', 'Contact phone', ['phone', 'mobile', 'טלפון', 'נייד']),
    f('assigneeEmail', 'Assignee email', ['assignee', 'owner', 'assigned to', 'אחראי', 'משויך ל']),
    f('description', 'Description', ['details', 'notes', 'תיאור', 'הערות']),
    f('tags', 'Tags', ['labels', 'תגיות']),
    f('expectedCloseDate', 'Expected close date', ['close date', 'expected close', 'תאריך סגירה']),
  ],
  companies: [
    f('name', 'Name', ['company', 'company name', 'organization', 'שם', 'שם החברה', 'חברה'], true),
    f('domain', 'Domain', ['website', 'url', 'site', 'אתר', 'דומיין']),
    f('notes', 'Notes', ['note', 'comments', 'הערות']),
    f('tags', 'Tags', ['labels', 'תגיות']),
    f('ownerEmail', 'Owner email', ['owner', 'account owner', 'בעלים', 'אחראי']),
  ],
  deals: [
    f('title', 'Title', ['name', 'deal', 'deal name', 'כותרת', 'שם העסקה', 'עסקה'], true),
    f('value', 'Value', ['amount', 'ערך', 'סכום']),
    f('currency', 'Currency', ['מטבע']),
    f('pipeline', 'Pipeline', ['pipeline name', 'צינור', 'תהליך']),
    f(
      'stage',
      'Stage',
      ['deal stage', 'status', 'שלב', 'סטטוס'],
      false,
      'Stage name of the pipeline',
    ),
    f('ownerEmail', 'Owner email', ['owner', 'assignee', 'בעלים', 'אחראי']),
    f('contactEmail', 'Contact email', ['email', 'contact', 'אימייל', 'מייל']),
    f('companyName', 'Company', ['company', 'organization', 'חברה']),
    f('expectedCloseAt', 'Expected close date', ['close date', 'expected close', 'תאריך סגירה']),
    f('description', 'Description', ['details', 'תיאור']),
    f('tags', 'Tags', ['labels', 'תגיות']),
    f('lostReason', 'Lost reason', ['reason', 'סיבת הפסד']),
  ],
};

export const importFieldSpecSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  aliases: z.array(z.string()),
  hint: z.string().optional(),
});

/** column index per field key (`null` = not imported). */
export const importMappingSchema = z.record(
  z.string().max(60),
  z.number().int().min(0).max(IMPORT_MAX_COLUMNS).nullable(),
);
export type ImportMapping = z.infer<typeof importMappingSchema>;

/** Lower-cases, NFKC-normalises and drops everything but letters/digits (works for Hebrew). */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Proposes a mapping from the file's headers; each header is used for at most one field. */
export function suggestMapping(entity: ImportEntity, headers: readonly string[]): ImportMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ImportMapping = {};
  const fields = IMPORT_FIELDS[entity];
  // Exact key/label matches first so e.g. "Email" binds to `email` before aliases of other fields can claim it.
  for (const pass of ['exact', 'alias'] as const) {
    for (const field of fields) {
      if (mapping[field.key] !== undefined && mapping[field.key] !== null) continue;
      const names = pass === 'exact' ? [field.key, field.label] : field.aliases;
      const wanted = new Set(names.map(normalizeHeader));
      const index = normalized.findIndex((h, i) => !used.has(i) && h !== '' && wanted.has(h));
      if (index >= 0) {
        used.add(index);
        mapping[field.key] = index;
      }
    }
  }
  for (const field of fields) if (mapping[field.key] === undefined) mapping[field.key] = null;
  return mapping;
}

/** Problems with a mapping itself (unknown field, column out of range, missing required fields). */
export function validateMapping(
  entity: ImportEntity,
  mapping: ImportMapping,
  columnCount: number,
): string[] {
  const problems: string[] = [];
  const specs = new Map(IMPORT_FIELDS[entity].map((s) => [s.key, s]));
  for (const [key, index] of Object.entries(mapping)) {
    if (!specs.has(key)) problems.push(`Unknown field "${key}"`);
    else if (index !== null && index >= columnCount) {
      problems.push(`Column ${index + 1} for "${key}" does not exist in the file`);
    }
  }
  const mapped = (key: string) => mapping[key] !== undefined && mapping[key] !== null;
  if (entity === 'contacts') {
    if (!mapped('firstName') && !mapped('fullName'))
      problems.push('Map either "First name" or "Full name"');
  } else {
    for (const spec of IMPORT_FIELDS[entity]) {
      if (spec.required && !mapped(spec.key)) problems.push(`"${spec.label}" must be mapped`);
    }
  }
  return problems;
}

/** One CSV row → values by field key (trimmed; the export-side formula escape is removed; unmapped = ''). */
export function rowToFields(
  entity: ImportEntity,
  mapping: ImportMapping,
  cells: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of IMPORT_FIELDS[entity]) {
    const index = mapping[spec.key];
    let value = index === undefined || index === null ? '' : (cells[index] ?? '');
    // eslint-disable-next-line no-control-regex
    value = value.replace(/\u0000/g, '').trim();
    if (/^'[=+\-@\t\r]/.test(value)) value = value.slice(1);
    out[spec.key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

export interface RowIssue {
  field: string | null;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseEmail(value: string): { value?: string; error?: string } {
  if (value === '') return {};
  const email = value.toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email)
    ? { value: email }
    : { error: 'Invalid email address' };
}

/** "₪1,200.50", "1.200,50", "1200", "12 000" → number. */
export function parseMoney(value: string): { value?: number; error?: string } {
  if (value === '') return {};
  let s = value.replace(/[\s\u00A0₪$€£]|ILS|USD|EUR|NIS|ש"ח|שקל/gi, '');
  if (s === '') return { error: 'Invalid number' };
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s =
      /,\d{1,2}$/.test(s) && s.indexOf(',') === lastComma
        ? s.replace(',', '.')
        : s.replace(/,/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Invalid number' };
  const n = Number(s);
  if (!Number.isFinite(n) || n > 99_999_999_999.99) return { error: 'Number out of range' };
  return { value: Math.round(n * 100) / 100 };
}

/** ISO (`2026-03-31`, with optional time) or Israeli/European `31/3/2026`, `31.03.2026`, `31-03-2026` → ISO string (UTC). */
export function parseDateValue(value: string): { value?: string; error?: string } {
  if (value === '') return {};
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(value);
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
    if (value.length > 10) {
      const t = new Date(value);
      if (!Number.isNaN(t.getTime())) return { value: t.toISOString() };
    }
  } else if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  } else return { error: 'Invalid date (use YYYY-MM-DD or DD/MM/YYYY)' };
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { error: 'Invalid calendar date' };
  }
  return { value: date.toISOString() };
}

export function parseTagList(value: string): { value: string[]; error?: string } {
  if (value === '') return { value: [] };
  const tags = [
    ...new Set(
      value
        .split(/[;,|،]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
  if (tags.length > 20) return { value: [], error: 'At most 20 tags' };
  if (tags.some((t) => t.length > 40))
    return { value: [], error: 'A tag is longer than 40 characters' };
  return { value: tags };
}

export function parseEnumValue<T extends string>(
  value: string,
  options: readonly T[],
  label: string,
): { value?: T; error?: string } {
  if (value === '') return {};
  const wanted = value.toLowerCase().replace(/[\s-]+/g, '_');
  const hit = options.find((o) => o === wanted);
  return hit
    ? { value: hit }
    : { error: `Unknown ${label} "${value.slice(0, 40)}" (expected ${options.join(', ')})` };
}

/** "https://www.Example.com/path" → "example.com"; invalid → error. */
export function parseDomain(value: string): { value?: string; error?: string } {
  if (value === '') return {};
  const d = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
  if (
    d.length > 160 ||
    !/^[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?(\.[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u.test(
      d,
    )
  ) {
    return { error: 'Invalid domain' };
  }
  return { value: d };
}

export function parseCurrency(value: string): { value?: string; error?: string } {
  if (value === '') return {};
  const c = value.toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return { value: c };
  if (value === '₪' || /^(nis|ש"ח|שקל)$/i.test(value)) return { value: 'ILS' };
  if (value === '$') return { value: 'USD' };
  if (value === '€') return { value: 'EUR' };
  return { error: 'Currency must be a 3-letter code such as USD or ILS' };
}

// ---------------------------------------------------------------------------
// Duplicate keys
// ---------------------------------------------------------------------------

/** Lower-cased email (the database column is case-insensitive). */
export function emailKey(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/** Last 9 digits of the phone (so 050-123-4567 and +972 50 123 4567 match); null when fewer than 7 digits. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-9);
}

/** NFKC, lower case, collapsed whitespace: "  ACME  Ltd " and "acme ltd" collide. */
export function nameKey(name: string | null | undefined): string | null {
  const n = (name ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return n ? n : null;
}

// ---------------------------------------------------------------------------
// Row normalisation
// ---------------------------------------------------------------------------

export type NormalizedRow<T> = { ok: true; data: T } | { ok: false; errors: RowIssue[] };

class Collector {
  readonly errors: RowIssue[] = [];
  take<V>(field: string, result: { value?: V; error?: string }): V | undefined {
    if (result.error) this.errors.push({ field, message: result.error });
    return result.value;
  }
  text(field: string, value: string, max: number, required = false): string | undefined {
    if (value === '') {
      if (required) this.errors.push({ field, message: 'Required' });
      return undefined;
    }
    if (value.length > max) {
      this.errors.push({ field, message: `Longer than ${max} characters` });
      return undefined;
    }
    return value;
  }
  tags(field: string, value: string): string[] {
    const r = parseTagList(value);
    if (r.error) this.errors.push({ field, message: r.error });
    return r.value;
  }
}

export interface ContactImportData {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  tags: string[];
  notes?: string;
  ownerEmail?: string;
}

export function normalizeContactRow(
  fields: Record<string, string>,
): NormalizedRow<ContactImportData> {
  const c = new Collector();
  let first = fields.firstName ?? '';
  let last = fields.lastName ?? '';
  const full = fields.fullName ?? '';
  if (first === '' && full !== '') {
    const parts = full.split(/\s+/);
    first = parts.shift() ?? '';
    if (last === '') last = parts.join(' ');
  }
  const firstName = c.text('firstName', first, 80, true);
  const lastName = c.text('lastName', last, 80);
  const email = c.take('email', parseEmail(fields.email ?? ''));
  const phone = c.text('phone', fields.phone ?? '', 32);
  const company = c.text('company', fields.company ?? '', 120);
  const jobTitle = c.text('jobTitle', fields.jobTitle ?? '', 120);
  const notes = c.text('notes', fields.notes ?? '', 5000);
  const tags = c.tags('tags', fields.tags ?? '');
  const ownerEmail = c.take('ownerEmail', parseEmail(fields.ownerEmail ?? ''));
  if (c.errors.length > 0 || !firstName) return { ok: false, errors: c.errors };
  return {
    ok: true,
    data: {
      firstName,
      tags,
      ...(lastName ? { lastName } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(company ? { company } : {}),
      ...(jobTitle ? { jobTitle } : {}),
      ...(notes ? { notes } : {}),
      ...(ownerEmail ? { ownerEmail } : {}),
    },
  };
}

export interface LeadImportData {
  title: string;
  status?: LeadStatus;
  source: LeadSource;
  value?: number;
  currency?: string;
  contactEmail?: string;
  contactPhone?: string;
  assigneeEmail?: string;
  description?: string;
  tags: string[];
  expectedCloseDate?: string;
}

export function normalizeLeadRow(fields: Record<string, string>): NormalizedRow<LeadImportData> {
  const c = new Collector();
  const title = c.text('title', fields.title ?? '', 160, true);
  const status = c.take(
    'status',
    parseEnumValue(fields.status ?? '', LeadStatus.options, 'status'),
  );
  const source = c.take(
    'source',
    parseEnumValue(fields.source ?? '', LeadSource.options, 'source'),
  );
  const value = c.take('value', parseMoney(fields.value ?? ''));
  const currency = c.take('currency', parseCurrency(fields.currency ?? ''));
  const contactEmail = c.take('contactEmail', parseEmail(fields.contactEmail ?? ''));
  const contactPhone = c.text('contactPhone', fields.contactPhone ?? '', 32);
  const assigneeEmail = c.take('assigneeEmail', parseEmail(fields.assigneeEmail ?? ''));
  const description = c.text('description', fields.description ?? '', 5000);
  const tags = c.tags('tags', fields.tags ?? '');
  const expectedCloseDate = c.take(
    'expectedCloseDate',
    parseDateValue(fields.expectedCloseDate ?? ''),
  );
  if (c.errors.length > 0 || !title) return { ok: false, errors: c.errors };
  return {
    ok: true,
    data: {
      title,
      source: source ?? 'import',
      tags,
      ...(status ? { status } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(currency ? { currency } : {}),
      ...(contactEmail ? { contactEmail } : {}),
      ...(contactPhone ? { contactPhone } : {}),
      ...(assigneeEmail ? { assigneeEmail } : {}),
      ...(description ? { description } : {}),
      ...(expectedCloseDate ? { expectedCloseDate } : {}),
    },
  };
}

export interface CompanyImportData {
  name: string;
  domain?: string;
  notes?: string;
  tags: string[];
  ownerEmail?: string;
}

export function normalizeCompanyRow(
  fields: Record<string, string>,
): NormalizedRow<CompanyImportData> {
  const c = new Collector();
  const name = c.text('name', fields.name ?? '', 160, true);
  const domain = c.take('domain', parseDomain(fields.domain ?? ''));
  const notes = c.text('notes', fields.notes ?? '', 5000);
  const tags = c.tags('tags', fields.tags ?? '');
  const ownerEmail = c.take('ownerEmail', parseEmail(fields.ownerEmail ?? ''));
  if (c.errors.length > 0 || !name) return { ok: false, errors: c.errors };
  return {
    ok: true,
    data: {
      name,
      tags,
      ...(domain ? { domain } : {}),
      ...(notes ? { notes } : {}),
      ...(ownerEmail ? { ownerEmail } : {}),
    },
  };
}

export interface DealImportData {
  title: string;
  value?: number;
  currency?: string;
  pipeline?: string;
  stage?: string;
  ownerEmail?: string;
  contactEmail?: string;
  companyName?: string;
  expectedCloseAt?: string;
  description?: string;
  tags: string[];
  lostReason?: string;
}

export function normalizeDealRow(fields: Record<string, string>): NormalizedRow<DealImportData> {
  const c = new Collector();
  const title = c.text('title', fields.title ?? '', 200, true);
  const value = c.take('value', parseMoney(fields.value ?? ''));
  const currency = c.take('currency', parseCurrency(fields.currency ?? ''));
  const pipeline = c.text('pipeline', fields.pipeline ?? '', 120);
  const stage = c.text('stage', fields.stage ?? '', 80);
  const ownerEmail = c.take('ownerEmail', parseEmail(fields.ownerEmail ?? ''));
  const contactEmail = c.take('contactEmail', parseEmail(fields.contactEmail ?? ''));
  const companyName = c.text('companyName', fields.companyName ?? '', 160);
  const expectedCloseAt = c.take('expectedCloseAt', parseDateValue(fields.expectedCloseAt ?? ''));
  const description = c.text('description', fields.description ?? '', 5000);
  const tags = c.tags('tags', fields.tags ?? '');
  const lostReason = c.text('lostReason', fields.lostReason ?? '', 500);
  if (c.errors.length > 0 || !title) return { ok: false, errors: c.errors };
  return {
    ok: true,
    data: {
      title,
      tags,
      ...(value !== undefined ? { value } : {}),
      ...(currency ? { currency } : {}),
      ...(pipeline ? { pipeline } : {}),
      ...(stage ? { stage } : {}),
      ...(ownerEmail ? { ownerEmail } : {}),
      ...(contactEmail ? { contactEmail } : {}),
      ...(companyName ? { companyName } : {}),
      ...(expectedCloseAt ? { expectedCloseAt } : {}),
      ...(description ? { description } : {}),
      ...(lostReason ? { lostReason } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// API schemas: import jobs
// ---------------------------------------------------------------------------

export const importProgressSchema = z.object({
  processed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
});

export const importRowIssueSchema = z.object({ field: z.string().nullable(), message: z.string() });

export const dryRunRowSchema = z.object({
  /** 1-based data row (the header is row 0). */
  row: z.number().int().positive(),
  status: z.enum(['valid', 'invalid', 'duplicate']),
  errors: z.array(importRowIssueSchema),
  duplicateOf: z
    .object({
      source: z.enum(['existing', 'file']),
      id: idSchema.optional(),
      row: z.number().int().positive().optional(),
      matchedBy: z.enum(['email', 'phone', 'name', 'title']),
    })
    .optional(),
});
export type DryRunRow = z.infer<typeof dryRunRowSchema>;

export const importValidationSchema = z.object({
  validatedAt: z.string().datetime(),
  total: z.number().int().nonnegative(),
  /** Rows that would be created. */
  valid: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  /** Rows matching an existing record or an earlier row of the file. */
  duplicates: z.number().int().nonnegative(),
  /** Only rows with problems (invalid or duplicate), capped at `IMPORT_VALIDATION_ROW_CAP`. */
  rows: z.array(dryRunRowSchema),
  truncated: z.boolean(),
});
export type ImportValidation = z.infer<typeof importValidationSchema>;

export const importReportRowSchema = z.object({
  row: z.number().int().positive(),
  status: z.enum(['updated', 'skipped', 'failed']),
  reason: z.string(),
});
export type ImportReportRow = z.infer<typeof importReportRowSchema>;

export const importJobSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    entity: ImportEntity,
    status: ImportStatus,
    fileName: z.string(),
    sizeBytes: z.number().int(),
    encoding: z.string().nullable(),
    delimiter: z.string().nullable(),
    headers: z.array(z.string()),
    totalRows: z.number().int(),
    mapping: importMappingSchema.nullable(),
    duplicateStrategy: DuplicateStrategy,
    validation: importValidationSchema.nullable(),
    progress: importProgressSchema,
    result: z.object({
      created: z.number().int(),
      updated: z.number().int(),
      skipped: z.number().int(),
      failed: z.number().int(),
    }),
    error: z.string().nullable(),
    createdById: idSchema.nullable(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
  })
  .merge(timestampsSchema);
export type ImportJob = z.infer<typeof importJobSchema>;

/** Response of the upload: the job plus what the mapping UI needs. */
export const importUploadResultSchema = importJobSchema.extend({
  sampleRows: z.array(z.array(z.string())),
  suggestedMapping: importMappingSchema,
  fields: z.array(importFieldSpecSchema),
});
export type ImportUploadResult = z.infer<typeof importUploadResultSchema>;

export const uploadImportFieldsSchema = z.object({ entity: ImportEntity });
export type UploadImportFields = z.infer<typeof uploadImportFieldsSchema>;

/** `POST /imports/:id/validate` (dry run) and `POST /imports/:id/execute` share this body. */
export const importConfigSchema = z.object({
  mapping: importMappingSchema,
  duplicateStrategy: DuplicateStrategy.default('skip'),
});
export type ImportConfig = z.infer<typeof importConfigSchema>;

export const listImportsQuerySchema = paginationQuerySchema.extend({
  entity: ImportEntity.optional(),
  status: ImportStatus.optional(),
});
export type ListImportsQuery = z.infer<typeof listImportsQuerySchema>;

export const importReportSchema = z.object({
  importId: idSchema,
  status: ImportStatus,
  result: z.object({
    created: z.number().int(),
    updated: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
  }),
  /** Skipped / failed rows with the reason (capped at `IMPORT_REPORT_CAP`; counts are exact). */
  rows: z.array(importReportRowSchema),
  truncated: z.boolean(),
});
export type ImportReport = z.infer<typeof importReportSchema>;

// ---------------------------------------------------------------------------
// API schemas: exports (the same filters as the list endpoints, without pagination)
// ---------------------------------------------------------------------------

export const exportContactsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
  ownerId: idSchema.optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'firstName', 'company']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type ExportContactsQuery = z.infer<typeof exportContactsQuerySchema>;

export const exportLeadsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: LeadStatus.optional(),
  source: LeadSource.optional(),
  assigneeId: idSchema.optional(),
  contactId: idSchema.optional(),
  tag: z.string().trim().max(40).optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'value', 'expectedCloseDate', 'title'])
    .default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type ExportLeadsQuery = z.infer<typeof exportLeadsQuerySchema>;

export const exportCompaniesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
  ownerId: idSchema.optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'name']).default('name'),
  sortOrder: sortOrderSchema.default('asc'),
});
export type ExportCompaniesQuery = z.infer<typeof exportCompaniesQuerySchema>;

export const exportDealsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  pipelineId: idSchema.optional(),
  stageId: idSchema.optional(),
  status: DealStatus.optional(),
  ownerId: z.union([idSchema, z.literal('me')]).optional(),
  contactId: idSchema.optional(),
  companyId: idSchema.optional(),
  tag: z.string().trim().max(40).optional(),
  minValue: z.coerce.number().nonnegative().optional(),
  maxValue: z.coerce.number().nonnegative().optional(),
  expectedCloseFrom: z.string().datetime().optional(),
  expectedCloseTo: z.string().datetime().optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'value', 'expectedCloseAt', 'title'])
    .default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type ExportDealsQuery = z.infer<typeof exportDealsQuerySchema>;

export const exportTasksQuerySchema = z.object({
  status: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(TaskStatus).min(1))
    .optional(),
  priority: TaskPriority.optional(),
  assigneeId: z.union([idSchema, z.literal('me')]).optional(),
  overdue: queryBoolean.optional(),
});
export type ExportTasksQuery = z.infer<typeof exportTasksQuerySchema>;

/** Column headers of every export (also the round-trip contract with the import field keys). */
export const EXPORT_COLUMNS = {
  contacts: [
    'id',
    'firstName',
    'lastName',
    'email',
    'phone',
    'company',
    'jobTitle',
    'tags',
    'notes',
    'ownerEmail',
    'createdAt',
  ],
  leads: [
    'id',
    'title',
    'status',
    'source',
    'value',
    'currency',
    'contactEmail',
    'contactPhone',
    'assigneeEmail',
    'description',
    'tags',
    'expectedCloseDate',
    'createdAt',
  ],
  companies: ['id', 'name', 'domain', 'notes', 'tags', 'ownerEmail', 'createdAt'],
  deals: [
    'id',
    'title',
    'value',
    'currency',
    'pipeline',
    'stage',
    'status',
    'ownerEmail',
    'contactEmail',
    'companyName',
    'expectedCloseAt',
    'closedAt',
    'lostReason',
    'description',
    'tags',
    'createdAt',
  ],
} as const satisfies Record<ImportEntity, readonly string[]>;
