import {
  IMPORT_BATCH_SIZE,
  IMPORT_REPORT_CAP,
  IMPORT_VALIDATION_ROW_CAP,
  type CompanyImportData,
  type ContactImportData,
  type DealImportData,
  type DryRunRow,
  type DuplicateStrategy,
  type ImportEntity,
  type ImportMapping,
  type ImportReportRow,
  type ImportValidation,
  type LeadImportData,
  type NormalizedRow,
  type RowIssue,
  emailKey,
  nameKey,
  normalizeCompanyRow,
  normalizeContactRow,
  normalizeDealRow,
  normalizeLeadRow,
  phoneKey,
  rowToFields,
} from '@hilatech/contracts';

import { type Prisma, type PrismaClient } from '../generated/client';
import { createDealRow, moveDealRow } from './deals';
import { type Db, ensureDefaultPipeline } from './pipelines';

/**
 * CSV import engine shared by the API (dry run) and the workers (execution). It turns parsed CSV rows into
 * contacts / leads / companies / deals for ONE organization:
 *   normalise → resolve references (owners, contacts, companies, pipelines) → detect duplicates (database AND earlier
 *   rows of the file) → apply the strategy (skip / update / create).
 * Every lookup and write is scoped by `organizationId`; nothing here trusts ids from the file.
 */

export interface ImportContext {
  organizationId: string;
  /** User recorded as actor / default owner (the importer). */
  actorId: string | null;
  entity: ImportEntity;
  mapping: ImportMapping;
  strategy: DuplicateStrategy;
  importId?: string;
}

type DuplicateOf = NonNullable<DryRunRow['duplicateOf']>;

export interface RowOutcome {
  /** 1-based data row number. */
  row: number;
  kind: 'created' | 'updated' | 'skipped' | 'failed' | 'invalid';
  reason?: string;
  errors?: RowIssue[];
  duplicateOf?: DuplicateOf;
}

/** Keys of records seen earlier in the same file (and, in apply mode, created earlier in the batch). */
export type SeenKeys = Map<string, { id?: string; row: number }>;

interface Keyed {
  key: string;
  matchedBy: DuplicateOf['matchedBy'];
}

interface Handler<D, R> {
  normalize(fields: Record<string, string>): NormalizedRow<D>;
  prefetch(db: Db, ctx: ImportContext, items: D[]): Promise<R>;
  /** Reference problems (unknown owner, unknown stage …) as row errors. */
  refErrors(data: D, refs: R): RowIssue[];
  keys(data: D, refs: R): Keyed[];
  existing(key: string, refs: R): string | undefined;
  create(tx: Db, ctx: ImportContext, data: D, refs: R): Promise<string>;
  update(tx: Db, ctx: ImportContext, id: string, data: D, refs: R): Promise<void>;
}

const unique = <T>(values: Array<T | undefined | null | ''>): T[] => [
  ...new Set(values.filter((v): v is T => v !== undefined && v !== null && v !== '')),
];

const chunk = <T>(items: T[], size = 500): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

async function ownersByEmail(
  db: Db,
  organizationId: string,
  emails: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk(emails)) {
    const rows = await db.organizationMember.findMany({
      where: { organizationId, status: 'active', user: { isActive: true, email: { in: part } } },
      select: { userId: true, user: { select: { email: true } } },
    });
    for (const r of rows) out.set(r.user.email.toLowerCase(), r.userId);
  }
  return out;
}

async function contactsByKeys(
  db: Db,
  organizationId: string,
  emails: string[],
  phones: string[],
): Promise<{ byEmail: Map<string, string>; byPhone: Map<string, string> }> {
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const part of chunk(emails)) {
    const rows = await db.contact.findMany({
      where: { organizationId, deletedAt: null, email: { in: part } },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of rows)
      if (r.email && !byEmail.has(r.email.toLowerCase())) byEmail.set(r.email.toLowerCase(), r.id);
  }
  for (const part of chunk(phones)) {
    const rows = await db.$queryRaw<Array<{ id: string; k: string }>>`
      SELECT "id", right(regexp_replace("phone", '\\D', '', 'g'), 9) AS k
      FROM "Contact"
      WHERE "organizationId" = ${organizationId}::uuid AND "deletedAt" IS NULL AND "phone" IS NOT NULL
        AND right(regexp_replace("phone", '\\D', '', 'g'), 9) = ANY(${part}::text[])
      ORDER BY "createdAt" ASC`;
    for (const r of rows) if (!byPhone.has(r.k)) byPhone.set(r.k, r.id);
  }
  return { byEmail, byPhone };
}

async function companiesByName(
  db: Db,
  organizationId: string,
  names: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const lowered = unique(names.map((n) => n.toLowerCase().trim()));
  for (const part of chunk(lowered)) {
    const rows = await db.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name" FROM "Company"
      WHERE "organizationId" = ${organizationId}::uuid AND lower(btrim("name")) = ANY(${part}::text[])
      ORDER BY "createdAt" ASC`;
    for (const r of rows) {
      const key = nameKey(r.name);
      if (key && !out.has(key)) out.set(key, r.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

interface ContactRefs {
  owners: Map<string, string>;
  byEmail: Map<string, string>;
  byPhone: Map<string, string>;
  companies: Map<string, string>;
}

const contactsHandler: Handler<ContactImportData, ContactRefs> = {
  normalize: normalizeContactRow,
  async prefetch(db, ctx, items) {
    const [owners, found, companies] = await Promise.all([
      ownersByEmail(db, ctx.organizationId, unique(items.map((i) => i.ownerEmail))),
      contactsByKeys(
        db,
        ctx.organizationId,
        unique(items.map((i) => emailKey(i.email))),
        unique(items.map((i) => phoneKey(i.phone))),
      ),
      companiesByName(db, ctx.organizationId, unique(items.map((i) => i.company))),
    ]);
    return { owners, ...found, companies };
  },
  refErrors(d, refs) {
    return d.ownerEmail && !refs.owners.has(d.ownerEmail)
      ? [{ field: 'ownerEmail', message: 'Owner is not an active member of this organization' }]
      : [];
  },
  keys(d) {
    const out: Keyed[] = [];
    const e = emailKey(d.email);
    const p = phoneKey(d.phone);
    if (e) out.push({ key: `e:${e}`, matchedBy: 'email' });
    if (p) out.push({ key: `p:${p}`, matchedBy: 'phone' });
    return out;
  },
  existing(key, refs) {
    return key.startsWith('e:') ? refs.byEmail.get(key.slice(2)) : refs.byPhone.get(key.slice(2));
  },
  async create(tx, ctx, d, refs) {
    const companyId = d.company ? refs.companies.get(nameKey(d.company) ?? '') : undefined;
    const row = await tx.contact.create({
      data: {
        organizationId: ctx.organizationId,
        firstName: d.firstName,
        lastName: d.lastName ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        company: d.company ?? null,
        companyId: companyId ?? null,
        jobTitle: d.jobTitle ?? null,
        tags: d.tags,
        notes: d.notes ?? null,
        ownerId: (d.ownerEmail ? refs.owners.get(d.ownerEmail) : undefined) ?? ctx.actorId,
      },
      select: { id: true },
    });
    return row.id;
  },
  async update(tx, ctx, id, d, refs) {
    const current = await tx.contact.findFirst({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      select: { tags: true },
    });
    if (!current) return;
    const companyId = d.company ? refs.companies.get(nameKey(d.company) ?? '') : undefined;
    await tx.contact.update({
      where: { id },
      data: {
        firstName: d.firstName,
        ...(d.lastName ? { lastName: d.lastName } : {}),
        ...(d.email ? { email: d.email } : {}),
        ...(d.phone ? { phone: d.phone } : {}),
        ...(d.company ? { company: d.company } : {}),
        ...(companyId ? { companyId } : {}),
        ...(d.jobTitle ? { jobTitle: d.jobTitle } : {}),
        ...(d.notes ? { notes: d.notes } : {}),
        ...(d.tags.length ? { tags: union(current.tags, d.tags) } : {}),
        ...(d.ownerEmail && refs.owners.get(d.ownerEmail)
          ? { ownerId: refs.owners.get(d.ownerEmail) }
          : {}),
      },
    });
  },
};

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

interface CompanyRefs {
  owners: Map<string, string>;
  byName: Map<string, string>;
}

const companiesHandler: Handler<CompanyImportData, CompanyRefs> = {
  normalize: normalizeCompanyRow,
  async prefetch(db, ctx, items) {
    const [owners, byName] = await Promise.all([
      ownersByEmail(db, ctx.organizationId, unique(items.map((i) => i.ownerEmail))),
      companiesByName(
        db,
        ctx.organizationId,
        items.map((i) => i.name),
      ),
    ]);
    return { owners, byName };
  },
  refErrors(d, refs) {
    return d.ownerEmail && !refs.owners.has(d.ownerEmail)
      ? [{ field: 'ownerEmail', message: 'Owner is not an active member of this organization' }]
      : [];
  },
  keys(d) {
    const n = nameKey(d.name);
    return n ? [{ key: `n:${n}`, matchedBy: 'name' }] : [];
  },
  existing(key, refs) {
    return refs.byName.get(key.slice(2));
  },
  async create(tx, ctx, d, refs) {
    const row = await tx.company.create({
      data: {
        organizationId: ctx.organizationId,
        name: d.name,
        domain: d.domain ?? null,
        notes: d.notes ?? null,
        tags: d.tags,
        ownerId: (d.ownerEmail ? refs.owners.get(d.ownerEmail) : undefined) ?? ctx.actorId,
      },
      select: { id: true },
    });
    return row.id;
  },
  async update(tx, ctx, id, d, refs) {
    const current = await tx.company.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { tags: true },
    });
    if (!current) return;
    await tx.company.update({
      where: { id },
      data: {
        ...(d.domain ? { domain: d.domain } : {}),
        ...(d.notes ? { notes: d.notes } : {}),
        ...(d.tags.length ? { tags: union(current.tags, d.tags) } : {}),
        ...(d.ownerEmail && refs.owners.get(d.ownerEmail)
          ? { ownerId: refs.owners.get(d.ownerEmail) }
          : {}),
      },
    });
  },
};

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

interface LeadRefs {
  owners: Map<string, string>;
  byEmail: Map<string, string>;
  byPhone: Map<string, string>;
  /** `${contactId or ''}|${titleKey}` → lead id */
  leads: Map<string, string>;
}

function leadContactId(d: LeadImportData, refs: LeadRefs): string | undefined {
  const e = emailKey(d.contactEmail);
  const p = phoneKey(d.contactPhone);
  return (e ? refs.byEmail.get(e) : undefined) ?? (p ? refs.byPhone.get(p) : undefined);
}

const leadsHandler: Handler<LeadImportData, LeadRefs> = {
  normalize: normalizeLeadRow,
  async prefetch(db, ctx, items) {
    const [owners, found] = await Promise.all([
      ownersByEmail(db, ctx.organizationId, unique(items.map((i) => i.assigneeEmail))),
      contactsByKeys(
        db,
        ctx.organizationId,
        unique(items.map((i) => emailKey(i.contactEmail))),
        unique(items.map((i) => phoneKey(i.contactPhone))),
      ),
    ]);
    const leads = new Map<string, string>();
    const titles = unique(items.map((i) => i.title.toLowerCase().trim()));
    for (const part of chunk(titles)) {
      const rows = await db.$queryRaw<
        Array<{ id: string; title: string; contactId: string | null }>
      >`
        SELECT "id", "title", "contactId" FROM "Lead"
        WHERE "organizationId" = ${ctx.organizationId}::uuid AND "deletedAt" IS NULL
          AND lower(btrim("title")) = ANY(${part}::text[])
        ORDER BY "createdAt" ASC`;
      for (const r of rows) {
        const k = `${r.contactId ?? ''}|${nameKey(r.title) ?? ''}`;
        if (!leads.has(k)) leads.set(k, r.id);
      }
    }
    return { owners, ...found, leads };
  },
  refErrors(d, refs) {
    return d.assigneeEmail && !refs.owners.has(d.assigneeEmail)
      ? [
          {
            field: 'assigneeEmail',
            message: 'Assignee is not an active member of this organization',
          },
        ]
      : [];
  },
  keys(d, refs) {
    const t = nameKey(d.title);
    return t ? [{ key: `l:${leadContactId(d, refs) ?? ''}|${t}`, matchedBy: 'title' }] : [];
  },
  existing(key, refs) {
    return refs.leads.get(key.slice(2));
  },
  async create(tx, ctx, d, refs) {
    const row = await tx.lead.create({
      data: {
        organizationId: ctx.organizationId,
        title: d.title,
        status: d.status ?? 'new',
        source: d.source,
        value: d.value ?? null,
        currency: d.currency ?? 'USD',
        contactId: leadContactId(d, refs) ?? null,
        assigneeId: (d.assigneeEmail ? refs.owners.get(d.assigneeEmail) : undefined) ?? null,
        description: d.description ?? null,
        tags: d.tags,
        expectedCloseDate: d.expectedCloseDate ? new Date(d.expectedCloseDate) : null,
        ...(d.status === 'won' ? { convertedAt: new Date() } : {}),
      },
      select: { id: true },
    });
    await tx.leadActivity.create({
      data: {
        leadId: row.id,
        actorId: ctx.actorId,
        type: 'created',
        payload: { by: 'import', ...(ctx.importId ? { importId: ctx.importId } : {}) },
      },
    });
    return row.id;
  },
  async update(tx, ctx, id, d, refs) {
    const current = await tx.lead.findFirst({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      select: { tags: true, status: true, convertedAt: true },
    });
    if (!current) return;
    const fields: string[] = [];
    const data: Prisma.LeadUncheckedUpdateInput = {};
    const set = (name: string, apply: () => void) => {
      fields.push(name);
      apply();
    };
    if (d.status && d.status !== current.status) {
      set('status', () => {
        data.status = d.status as never;
        if (d.status === 'won' && !current.convertedAt) data.convertedAt = new Date();
      });
    }
    if (d.value !== undefined) set('value', () => (data.value = d.value));
    if (d.currency) set('currency', () => (data.currency = d.currency));
    if (d.description) set('description', () => (data.description = d.description));
    if (d.expectedCloseDate)
      set(
        'expectedCloseDate',
        () => (data.expectedCloseDate = new Date(d.expectedCloseDate as string)),
      );
    if (d.tags.length) set('tags', () => (data.tags = union(current.tags, d.tags)));
    const contactId = leadContactId(d, refs);
    if (contactId) set('contactId', () => (data.contactId = contactId));
    const assignee = d.assigneeEmail ? refs.owners.get(d.assigneeEmail) : undefined;
    if (assignee) set('assigneeId', () => (data.assigneeId = assignee));
    if (fields.length === 0) return;
    await tx.lead.update({ where: { id }, data });
    await tx.leadActivity.create({
      data: {
        leadId: id,
        actorId: ctx.actorId,
        type: 'updated',
        payload: { by: 'import', fields, ...(ctx.importId ? { importId: ctx.importId } : {}) },
      },
    });
  },
};

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

interface StageRef {
  id: string;
  name: string;
  order: number;
  kind: 'open' | 'won' | 'lost';
}
interface PipelineRef {
  id: string;
  name: string;
  stages: StageRef[];
}
interface DealRefs {
  owners: Map<string, string>;
  byEmail: Map<string, string>;
  companies: Map<string, string>;
  pipelines: Map<string, PipelineRef>;
  defaultPipeline: PipelineRef;
  /** `${pipelineId}|${titleKey}` → deal id */
  deals: Map<string, string>;
}

function resolveDealPipeline(d: DealImportData, refs: DealRefs): PipelineRef | undefined {
  if (!d.pipeline) return refs.defaultPipeline;
  return refs.pipelines.get(nameKey(d.pipeline) ?? '');
}

function resolveDealStage(pipeline: PipelineRef, name?: string): StageRef | undefined {
  if (name) {
    const wanted = nameKey(name);
    return pipeline.stages.find((s) => nameKey(s.name) === wanted);
  }
  return [...pipeline.stages].sort((a, b) => a.order - b.order).find((s) => s.kind === 'open');
}

const dealsHandler: Handler<DealImportData, DealRefs> = {
  normalize: normalizeDealRow,
  async prefetch(db, ctx, items) {
    const defaultPipeline = await ensureDefaultPipelineLite(db, ctx.organizationId);
    const [owners, found, companies, pipelineRows] = await Promise.all([
      ownersByEmail(db, ctx.organizationId, unique(items.map((i) => i.ownerEmail))),
      contactsByKeys(
        db,
        ctx.organizationId,
        unique(items.map((i) => emailKey(i.contactEmail))),
        [],
      ),
      companiesByName(db, ctx.organizationId, unique(items.map((i) => i.companyName))),
      db.pipeline.findMany({
        where: { organizationId: ctx.organizationId },
        include: { stages: { orderBy: { order: 'asc' } } },
      }),
    ]);
    const pipelines = new Map<string, PipelineRef>();
    for (const p of pipelineRows) {
      pipelines.set(nameKey(p.name) ?? p.id, {
        id: p.id,
        name: p.name,
        stages: p.stages.map((s) => ({ id: s.id, name: s.name, order: s.order, kind: s.kind })),
      });
    }
    const deals = new Map<string, string>();
    const titles = unique(items.map((i) => i.title.toLowerCase().trim()));
    for (const part of chunk(titles)) {
      const rows = await db.$queryRaw<Array<{ id: string; title: string; pipelineId: string }>>`
        SELECT "id", "title", "pipelineId" FROM "Deal"
        WHERE "organizationId" = ${ctx.organizationId}::uuid AND lower(btrim("title")) = ANY(${part}::text[])
        ORDER BY "createdAt" ASC`;
      for (const r of rows) {
        const k = `${r.pipelineId}|${nameKey(r.title) ?? ''}`;
        if (!deals.has(k)) deals.set(k, r.id);
      }
    }
    return { owners, byEmail: found.byEmail, companies, pipelines, defaultPipeline, deals };
  },
  refErrors(d, refs) {
    const errors: RowIssue[] = [];
    const pipeline = resolveDealPipeline(d, refs);
    if (!pipeline)
      errors.push({ field: 'pipeline', message: `Pipeline "${d.pipeline}" does not exist` });
    else if (!resolveDealStage(pipeline, d.stage)) {
      errors.push({
        field: 'stage',
        message: `Stage "${d.stage ?? ''}" does not exist in pipeline "${pipeline.name}"`,
      });
    }
    if (d.ownerEmail && !refs.owners.has(d.ownerEmail)) {
      errors.push({
        field: 'ownerEmail',
        message: 'Owner is not an active member of this organization',
      });
    }
    return errors;
  },
  keys(d, refs) {
    const t = nameKey(d.title);
    const p = resolveDealPipeline(d, refs);
    return t && p ? [{ key: `d:${p.id}|${t}`, matchedBy: 'title' }] : [];
  },
  existing(key, refs) {
    return refs.deals.get(key.slice(2));
  },
  async create(tx, ctx, d, refs) {
    const pipeline = resolveDealPipeline(d, refs) as PipelineRef;
    const stage = resolveDealStage(pipeline, d.stage) as StageRef;
    const email = emailKey(d.contactEmail);
    const { deal } = await createDealRow(
      tx,
      {
        organizationId: ctx.organizationId,
        title: d.title,
        description: d.description ?? null,
        value: d.value ?? null,
        currency: d.currency ?? 'USD',
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: (d.ownerEmail ? refs.owners.get(d.ownerEmail) : undefined) ?? ctx.actorId,
        contactId: (email ? refs.byEmail.get(email) : undefined) ?? null,
        companyId:
          (d.companyName ? refs.companies.get(nameKey(d.companyName) ?? '') : undefined) ?? null,
        expectedCloseAt: d.expectedCloseAt ? new Date(d.expectedCloseAt) : null,
        tags: d.tags,
        lostReason: d.lostReason ?? null,
      },
      { actorId: ctx.actorId, by: 'import', extra: ctx.importId ? { importId: ctx.importId } : {} },
    );
    return deal.id;
  },
  async update(tx, ctx, id, d, refs) {
    const current = await tx.deal.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { tags: true, stageId: true, pipelineId: true },
    });
    if (!current) return;
    const email = emailKey(d.contactEmail);
    const contactId = email ? refs.byEmail.get(email) : undefined;
    const companyId = d.companyName ? refs.companies.get(nameKey(d.companyName) ?? '') : undefined;
    const owner = d.ownerEmail ? refs.owners.get(d.ownerEmail) : undefined;
    await tx.deal.update({
      where: { id },
      data: {
        ...(d.value !== undefined ? { value: d.value } : {}),
        ...(d.currency ? { currency: d.currency } : {}),
        ...(d.description ? { description: d.description } : {}),
        ...(d.expectedCloseAt ? { expectedCloseAt: new Date(d.expectedCloseAt) } : {}),
        ...(d.tags.length ? { tags: union(current.tags, d.tags) } : {}),
        ...(contactId ? { contactId } : {}),
        ...(companyId ? { companyId } : {}),
        ...(owner ? { ownerId: owner } : {}),
      },
    });
    if (d.stage) {
      const pipeline = resolveDealPipeline(d, refs);
      const stage =
        pipeline && current.pipelineId === pipeline.id
          ? resolveDealStage(pipeline, d.stage)
          : undefined;
      if (stage && stage.id !== current.stageId) {
        await moveDealRow(
          tx,
          {
            organizationId: ctx.organizationId,
            dealId: id,
            toStageId: stage.id,
            lostReason: d.lostReason ?? null,
          },
          {
            actorId: ctx.actorId,
            by: 'import',
            extra: ctx.importId ? { importId: ctx.importId } : {},
          },
        );
      }
    }
  },
};

async function ensureDefaultPipelineLite(db: Db, organizationId: string): Promise<PipelineRef> {
  // `ensureDefaultPipeline` needs a full client (it may create rows); inside a transaction the pipeline already exists
  // because the API creates it with the organization / the migration backfilled it.
  const existing = await db.pipeline.findFirst({
    where: { organizationId, isDefault: true },
    include: { stages: { orderBy: { order: 'asc' } } },
  });
  const pipeline = existing ?? (await ensureDefaultPipeline(db as PrismaClient, organizationId));
  return {
    id: pipeline.id,
    name: pipeline.name,
    stages: pipeline.stages.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      kind: s.kind as StageRef['kind'],
    })),
  };
}

// ---------------------------------------------------------------------------
// Row processing
// ---------------------------------------------------------------------------

const HANDLERS = {
  contacts: contactsHandler,
  leads: leadsHandler,
  companies: companiesHandler,
  deals: dealsHandler,
} as unknown as Record<ImportEntity, Handler<unknown, unknown>>;

const label: Record<ImportEntity, string> = {
  contacts: 'contact',
  leads: 'lead',
  companies: 'company',
  deals: 'deal',
};

function describeDuplicate(entity: ImportEntity, dup: DuplicateOf): string {
  const what =
    dup.source === 'file' ? `row ${dup.row} of the file` : `an existing ${label[entity]}`;
  return `Duplicate of ${what} (matched by ${dup.matchedBy})`;
}

/**
 * Processes one slice of rows. `mode: 'dry'` never writes; `mode: 'apply'` must receive a transaction client and
 * writes each row under a savepoint so one bad row cannot poison the batch.
 */
async function processRows(
  db: Db,
  ctx: ImportContext,
  rows: ReadonlyArray<readonly string[]>,
  firstRow: number,
  seen: SeenKeys,
  mode: 'dry' | 'apply',
): Promise<RowOutcome[]> {
  const handler = HANDLERS[ctx.entity];
  const outcomes: RowOutcome[] = [];
  const parsed: Array<{ row: number; data: unknown } | null> = rows.map((cells, i) => {
    const row = firstRow + i;
    const normalized = handler.normalize(rowToFields(ctx.entity, ctx.mapping, cells));
    if (!normalized.ok) {
      outcomes.push({
        row,
        kind: 'invalid',
        errors: normalized.errors,
        reason: normalized.errors[0]?.message,
      });
      return null;
    }
    return { row, data: normalized.data };
  });
  const items = parsed.filter((p): p is { row: number; data: unknown } => p !== null);
  if (items.length === 0) return outcomes.sort((a, b) => a.row - b.row);
  const refs = await handler.prefetch(
    db,
    ctx,
    items.map((i) => i.data),
  );

  for (const item of items) {
    const errors = handler.refErrors(item.data, refs);
    if (errors.length > 0) {
      outcomes.push({ row: item.row, kind: 'invalid', errors, reason: errors[0]?.message });
      continue;
    }
    const keys = handler.keys(item.data, refs);
    let duplicate: { dup: DuplicateOf; id?: string } | undefined;
    for (const k of keys) {
      const existingId = handler.existing(k.key, refs);
      if (existingId) {
        duplicate = {
          dup: { source: 'existing', id: existingId, matchedBy: k.matchedBy },
          id: existingId,
        };
        break;
      }
      const earlier = seen.get(k.key);
      if (earlier) {
        duplicate = {
          dup: { source: 'file', row: earlier.row, matchedBy: k.matchedBy },
          ...(earlier.id ? { id: earlier.id } : {}),
        };
        break;
      }
    }

    const register = (id?: string) => {
      for (const k of keys)
        if (!seen.has(k.key)) seen.set(k.key, { row: item.row, ...(id ? { id } : {}) });
    };

    if (duplicate && ctx.strategy !== 'create') {
      if (ctx.strategy === 'skip' || !duplicate.id) {
        outcomes.push({
          row: item.row,
          kind: 'skipped',
          reason: describeDuplicate(ctx.entity, duplicate.dup),
          duplicateOf: duplicate.dup,
        });
        continue;
      }
      // strategy === 'update'
      if (mode === 'dry') {
        outcomes.push({
          row: item.row,
          kind: 'updated',
          duplicateOf: duplicate.dup,
          reason: 'Would update the existing record',
        });
        continue;
      }
      const outcome = await guarded(db, item.row, async () => {
        await handler.update(db, ctx, duplicate!.id as string, item.data, refs);
      });
      outcomes.push(
        outcome.error ? outcome : { row: item.row, kind: 'updated', duplicateOf: duplicate.dup },
      );
      continue;
    }

    if (mode === 'dry') {
      register();
      outcomes.push({
        row: item.row,
        kind: 'created',
        ...(duplicate ? { duplicateOf: duplicate.dup } : {}),
      });
      continue;
    }
    let createdId: string | undefined;
    const outcome = await guarded(db, item.row, async () => {
      createdId = await handler.create(db, ctx, item.data, refs);
    });
    if (outcome.error) {
      outcomes.push(outcome);
    } else {
      register(createdId);
      outcomes.push({ row: item.row, kind: 'created' });
    }
  }
  return outcomes.sort((a, b) => a.row - b.row);
}

/** Runs one row's writes under a savepoint; a failure rolls back only that row. */
async function guarded(
  db: Db,
  row: number,
  work: () => Promise<void>,
): Promise<RowOutcome & { error?: true }> {
  await db.$executeRawUnsafe('SAVEPOINT import_row');
  try {
    await work();
    await db.$executeRawUnsafe('RELEASE SAVEPOINT import_row');
    return { row, kind: 'created' };
  } catch (error) {
    await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT import_row');
    await db.$executeRawUnsafe('RELEASE SAVEPOINT import_row');
    const code = (error as { code?: string }).code;
    return {
      row,
      kind: 'failed',
      error: true,
      reason:
        code === 'P2002'
          ? 'A record with the same unique value already exists'
          : 'The row could not be saved',
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dry run: validates every row, resolves references and detects duplicates (existing records and earlier rows of the
 * file) without writing anything. `rows` are the data rows (header excluded).
 */
export async function validateImportRows(
  db: PrismaClient,
  ctx: ImportContext,
  rows: ReadonlyArray<readonly string[]>,
): Promise<ImportValidation> {
  const seen: SeenKeys = new Map();
  let valid = 0;
  let invalid = 0;
  let duplicates = 0;
  const problems: DryRunRow[] = [];
  for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
    const slice = rows.slice(start, start + IMPORT_BATCH_SIZE);
    const outcomes = await processRows(db, ctx, slice, start + 1, seen, 'dry');
    for (const o of outcomes) {
      let status: DryRunRow['status'];
      if (o.kind === 'invalid') {
        status = 'invalid';
        invalid += 1;
      } else if (o.duplicateOf) {
        status = 'duplicate';
        duplicates += 1;
        if (o.kind === 'created') valid += 1; // strategy "create": still created
      } else {
        status = 'valid';
        valid += 1;
      }
      if (status !== 'valid' && problems.length < IMPORT_VALIDATION_ROW_CAP) {
        problems.push({
          row: o.row,
          status,
          errors:
            o.errors ??
            (o.reason && status === 'duplicate' ? [{ field: null, message: o.reason }] : []),
          ...(o.duplicateOf ? { duplicateOf: o.duplicateOf } : {}),
        });
      }
    }
  }
  return {
    validatedAt: new Date().toISOString(),
    total: rows.length,
    valid,
    invalid,
    duplicates,
    rows: problems,
    truncated: invalid + duplicates > problems.length,
  };
}

export interface BatchResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Skipped / failed rows (the report). Invalid rows count as failed. */
  problems: ImportReportRow[];
}

/**
 * Applies one batch of rows atomically per batch (row-level failures are isolated with savepoints). The caller
 * persists the checkpoint (processed count) in its own step; re-running a batch is safe: rows already created are
 * found as duplicates.
 */
export async function applyImportBatch(
  db: PrismaClient,
  ctx: ImportContext,
  rows: ReadonlyArray<readonly string[]>,
  firstRow: number,
): Promise<BatchResult> {
  const outcomes = await db.$transaction(
    async (tx) => processRows(tx, ctx, rows, firstRow, new Map(), 'apply'),
    { timeout: 120_000, maxWait: 15_000 },
  );
  const result: BatchResult = { created: 0, updated: 0, skipped: 0, failed: 0, problems: [] };
  for (const o of outcomes) {
    if (o.kind === 'created') result.created += 1;
    else if (o.kind === 'updated') result.updated += 1;
    else if (o.kind === 'skipped') {
      result.skipped += 1;
      result.problems.push({ row: o.row, status: 'skipped', reason: o.reason ?? 'Skipped' });
    } else {
      result.failed += 1;
      result.problems.push({ row: o.row, status: 'failed', reason: o.reason ?? 'Invalid row' });
    }
  }
  return result;
}

/** Appends to a report keeping at most `IMPORT_REPORT_CAP` rows. */
export function appendReport(
  report: ImportReportRow[],
  more: readonly ImportReportRow[],
): { report: ImportReportRow[]; truncated: boolean } {
  const room = Math.max(0, IMPORT_REPORT_CAP - report.length);
  return {
    report: [...report, ...more.slice(0, room)],
    truncated: more.length > room,
  };
}
