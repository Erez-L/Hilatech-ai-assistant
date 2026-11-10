import { z } from 'zod';
import {
  idSchema,
  paginationQuerySchema,
  sortOrderSchema,
  timestampsSchema,
  userSummarySchema,
} from './common';
import { contactSchema, contactSummarySchema } from './crm';
import { queryBoolean } from './tasks';

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(160)
  .transform((v) => v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
  .refine((v) => v === '' || /^[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?(\.[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u.test(v), {
    message: 'Must be a domain like example.com',
  })
  .transform((v) => (v === '' ? undefined : v));

export const companySchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    name: z.string(),
    domain: z.string().nullable(),
    notes: z.string().nullable(),
    tags: z.array(z.string()),
    ownerId: idSchema.nullable(),
  })
  .merge(timestampsSchema);
export type Company = z.infer<typeof companySchema>;

export const companySummarySchema = companySchema.pick({ id: true, name: true, domain: true });
export type CompanySummary = z.infer<typeof companySummarySchema>;

export const companyDetailSchema = companySchema.extend({
  owner: userSummarySchema.nullable(),
  contactCount: z.number().int().nonnegative(),
  dealCount: z.number().int().nonnegative(),
});
export type CompanyDetail = z.infer<typeof companyDetailSchema>;

export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(160),
  domain: domainSchema.optional(),
  notes: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  ownerId: idSchema.optional(),
});
export type CreateCompanyRequest = z.infer<typeof createCompanySchema>;
export const updateCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    domain: domainSchema.nullable(),
    notes: z.string().trim().max(5000).nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    ownerId: idSchema.nullable(),
  })
  .partial();
export type UpdateCompanyRequest = z.infer<typeof updateCompanySchema>;

export const listCompaniesQuerySchema = paginationQuerySchema.extend({
  /** Matches name or domain. */
  search: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
  ownerId: idSchema.optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'name']).default('name'),
  sortOrder: sortOrderSchema.default('asc'),
});
export type ListCompaniesQuery = z.infer<typeof listCompaniesQuerySchema>;

export const associateContactsSchema = z.object({ contactIds: z.array(idSchema).min(1).max(100) });
export type AssociateContactsRequest = z.infer<typeof associateContactsSchema>;
export const associateContactsResultSchema = z.object({
  associated: z.number().int().nonnegative(),
  notFound: z.array(idSchema),
});
export type AssociateContactsResult = z.infer<typeof associateContactsResultSchema>;

export const companyContactSchema = contactSchema;

// ---------------------------------------------------------------------------
// Pipelines & stages
// ---------------------------------------------------------------------------

export const StageKind = z.enum(['open', 'won', 'lost']);
export type StageKind = z.infer<typeof StageKind>;
export const DealStatus = z.enum(['open', 'won', 'lost']);
export type DealStatus = z.infer<typeof DealStatus>;

export const pipelineStageSchema = z.object({
  id: idSchema,
  pipelineId: idSchema,
  name: z.string(),
  /** 0-based, contiguous. */
  order: z.number().int().nonnegative(),
  probability: z.number().int().min(0).max(100),
  kind: StageKind,
});
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const pipelineSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    name: z.string(),
    isDefault: z.boolean(),
    stages: z.array(pipelineStageSchema),
    dealCount: z.number().int().nonnegative(),
  })
  .merge(timestampsSchema);
export type Pipeline = z.infer<typeof pipelineSchema>;

const stageInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  probability: z.number().int().min(0).max(100).default(0),
  kind: StageKind.default('open'),
});

export const createPipelineSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Defaults to Lead, Qualified, Proposal, Negotiation, Won, Lost. */
  stages: z.array(stageInputSchema).min(3).max(20).optional(),
  isDefault: z.boolean().default(false),
});
export type CreatePipelineRequest = z.infer<typeof createPipelineSchema>;

export const updatePipelineSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** Only `true` is accepted: the previous default is demoted. */
    isDefault: z.literal(true),
  })
  .partial();
export type UpdatePipelineRequest = z.infer<typeof updatePipelineSchema>;

export const createStageSchema = stageInputSchema.extend({
  /** 0-based position; omitted = before the first closed stage (open) or at the end (won/lost). */
  order: z.number().int().min(0).optional(),
});
export type CreateStageRequest = z.infer<typeof createStageSchema>;
export const updateStageSchema = stageInputSchema.partial();
export type UpdateStageRequest = z.infer<typeof updateStageSchema>;

export const reorderStagesSchema = z.object({ stageIds: z.array(idSchema).min(1).max(30) });
export type ReorderStagesRequest = z.infer<typeof reorderStagesSchema>;

/** Deleting a stage that still holds deals requires a destination stage of the same pipeline. */
export const deleteStageQuerySchema = z.object({ moveDealsToStageId: idSchema.optional() });
export type DeleteStageQuery = z.infer<typeof deleteStageQuerySchema>;

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export const dealSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    title: z.string(),
    description: z.string().nullable(),
    value: z.number().nullable(),
    currency: z.string().length(3),
    pipelineId: idSchema,
    stageId: idSchema,
    status: DealStatus,
    /** Card order inside the stage column (0 = top). */
    position: z.number().int().nonnegative(),
    ownerId: idSchema.nullable(),
    contactId: idSchema.nullable(),
    companyId: idSchema.nullable(),
    expectedCloseAt: z.string().datetime().nullable(),
    closedAt: z.string().datetime().nullable(),
    lostReason: z.string().nullable(),
    tags: z.array(z.string()),
    stageEnteredAt: z.string().datetime(),
  })
  .merge(timestampsSchema);
export type Deal = z.infer<typeof dealSchema>;

export const dealWithRelationsSchema = dealSchema.extend({
  stage: pipelineStageSchema.pick({ id: true, name: true, kind: true, probability: true, order: true }),
  owner: userSummarySchema.nullable(),
  contact: contactSummarySchema.nullable(),
  company: companySummarySchema.nullable(),
});
export type DealWithRelations = z.infer<typeof dealWithRelationsSchema>;

export const createDealSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  value: z.number().nonnegative().max(99_999_999_999.99).optional(),
  currency: z.string().trim().toUpperCase().length(3).default('USD'),
  /** Defaults to the organization's default pipeline (or the pipeline of `stageId`). */
  pipelineId: idSchema.optional(),
  /** Defaults to the first open stage of the pipeline. */
  stageId: idSchema.optional(),
  ownerId: idSchema.optional(),
  contactId: idSchema.optional(),
  companyId: idSchema.optional(),
  expectedCloseAt: z.string().datetime().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type CreateDealRequest = z.infer<typeof createDealSchema>;

/** Stage changes go through `POST /deals/:id/move`. `null` clears an optional field. */
export const updateDealSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullable(),
    value: z.number().nonnegative().max(99_999_999_999.99).nullable(),
    currency: z.string().trim().toUpperCase().length(3),
    ownerId: idSchema.nullable(),
    contactId: idSchema.nullable(),
    companyId: idSchema.nullable(),
    expectedCloseAt: z.string().datetime().nullable(),
    lostReason: z.string().trim().max(500).nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
  })
  .partial();
export type UpdateDealRequest = z.infer<typeof updateDealSchema>;

export const moveDealSchema = z.object({
  stageId: idSchema,
  /** 0-based position inside the destination column; omitted = bottom. */
  position: z.number().int().min(0).optional(),
  /** Recorded when moving to a lost stage. */
  lostReason: z.string().trim().max(500).optional(),
});
export type MoveDealRequest = z.infer<typeof moveDealSchema>;

export const listDealsQuerySchema = paginationQuerySchema.extend({
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
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;

// ----- notes & activities ----------------------------------------------------------------------

export const dealNoteSchema = z.object({
  id: idSchema,
  dealId: idSchema,
  authorId: idSchema,
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type DealNote = z.infer<typeof dealNoteSchema>;
export const dealNoteWithAuthorSchema = dealNoteSchema.extend({ author: userSummarySchema.nullable() });
export type DealNoteWithAuthor = z.infer<typeof dealNoteWithAuthorSchema>;
export const createDealNoteSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export type CreateDealNoteRequest = z.infer<typeof createDealNoteSchema>;

export const DealActivityType = z.enum([
  'created',
  'stage_changed',
  'won',
  'lost',
  'reopened',
  'value_changed',
  'owner_changed',
  'note_added',
  'updated',
]);
export type DealActivityType = z.infer<typeof DealActivityType>;
export const dealActivitySchema = z.object({
  id: idSchema,
  dealId: idSchema,
  actorId: idSchema.nullable(),
  type: DealActivityType,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type DealActivity = z.infer<typeof dealActivitySchema>;
export const dealActivityWithActorSchema = dealActivitySchema.extend({
  actor: userSummarySchema.nullable(),
});
export type DealActivityWithActor = z.infer<typeof dealActivityWithActorSchema>;

// ----- Kanban board ----------------------------------------------------------------------------

/** Money is never summed across currencies: totals are listed per currency. */
export const currencyTotalSchema = z.object({
  currency: z.string().length(3),
  count: z.number().int().nonnegative(),
  value: z.number(),
  /** value × stage probability (open stages), 0 for lost. */
  weightedValue: z.number(),
});
export type CurrencyTotal = z.infer<typeof currencyTotalSchema>;

export const boardQuerySchema = z.object({
  /** Defaults to the default pipeline. */
  pipelineId: idSchema.optional(),
  ownerId: z.union([idSchema, z.literal('me')]).optional(),
  search: z.string().trim().max(200).optional(),
  /** Cards returned per column (the column `count` is always the full count). */
  limitPerColumn: z.coerce.number().int().min(1).max(200).default(50),
  /** Include won/lost columns' deals (they are columns of the pipeline too). */
  includeClosed: queryBoolean.default(true),
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

export const boardColumnSchema = z.object({
  stage: pipelineStageSchema,
  deals: z.array(dealWithRelationsSchema),
  count: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  totals: z.array(currencyTotalSchema),
});
export type BoardColumn = z.infer<typeof boardColumnSchema>;

export const dealBoardSchema = z.object({
  pipeline: pipelineSchema,
  columns: z.array(boardColumnSchema),
  totals: z.array(currencyTotalSchema),
});
export type DealBoard = z.infer<typeof dealBoardSchema>;

// ----- conversion report -----------------------------------------------------------------------

export const dealConversionQuerySchema = z.object({
  pipelineId: idSchema.optional(),
  /** Deals created in [from, to). Defaults: the last 90 days. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type DealConversionQuery = z.infer<typeof dealConversionQuerySchema>;

export const dealConversionReportSchema = z.object({
  generatedAt: z.string().datetime(),
  pipeline: z.object({ id: idSchema, name: z.string() }),
  range: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  /** Deals created in the range, by current status. */
  deals: z.object({
    created: z.number().int(),
    open: z.number().int(),
    won: z.number().int(),
    lost: z.number().int(),
  }),
  /** won / (won + lost) among deals created in the range that are closed. */
  winRate: z.number().nullable(),
  /** Average days from creation to won, for deals won (closedAt) in the range. */
  avgCycleDays: z.number().nullable(),
  stages: z.array(
    z.object({
      stageId: idSchema,
      name: z.string(),
      order: z.number().int(),
      /** Deals created in the range that entered this stage or a later open stage (or were won). */
      reached: z.number().int(),
      rateFromPrevious: z.number().nullable(),
      rateFromTop: z.number().nullable(),
    }),
  ),
  /** Current deals per stage and currency (open stages carry weighted value). */
  valueByStage: z.array(
    z.object({
      stageId: idSchema,
      name: z.string(),
      kind: StageKind,
      currency: z.string().length(3),
      count: z.number().int(),
      value: z.number(),
      weightedValue: z.number(),
    }),
  ),
  wonValue: z.array(z.object({ currency: z.string().length(3), count: z.number().int(), value: z.number() })),
  lostReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
});
export type DealConversionReport = z.infer<typeof dealConversionReportSchema>;
