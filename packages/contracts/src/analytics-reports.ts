import { z } from 'zod';
import { idSchema } from './common';
import { ConversationChannel, ConversationStatus, LeadSource, LeadStatus } from './crm';
import { AgentExecutionStatus } from './ai';
import { budgetStatusSchema } from './billing';

// ---------------------------------------------------------------------------
// Analytics reports (Priority 5). Every figure is an aggregate over the caller's organization only.
// Costs are `null` unless model pricing is configured (`AI_PRICING_JSON`) — prices are never invented.
// ---------------------------------------------------------------------------

export const ANALYTICS_MAX_RANGE_DAYS = 366;
export const ANALYTICS_DEFAULT_RANGE_DAYS = 30;

export const AnalyticsGranularity = z.enum(['day', 'week', 'month']);
export type AnalyticsGranularity = z.infer<typeof AnalyticsGranularity>;

/** `from` (inclusive) / `to` (exclusive) ISO timestamps. Defaults: the last 30 days ending now. */
export const analyticsRangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: AnalyticsGranularity.default('day'),
});
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;

export const AnalyticsExportReport = z.enum(['business', 'usage']);
export type AnalyticsExportReport = z.infer<typeof AnalyticsExportReport>;

export const analyticsExportQuerySchema = analyticsRangeQuerySchema.extend({
  report: AnalyticsExportReport,
  /** `series` = one row per time bucket; `breakdown` = one row per dimension value. */
  section: z.enum(['series', 'breakdown']).default('series'),
});
export type AnalyticsExportQuery = z.infer<typeof analyticsExportQuerySchema>;

export const analyticsRangeSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  granularity: AnalyticsGranularity,
  /** Number of buckets in every series of the response (all series are zero-filled to this length). */
  buckets: z.number().int().nonnegative(),
});
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

/** Start of the bucket (UTC): midnight, Monday 00:00 for `week`, first of month for `month`. */
const bucketSchema = z.string().datetime();
const countPointSchema = z.object({ bucket: bucketSchema, count: z.number().int() });
export type CountPoint = z.infer<typeof countPointSchema>;

const percentileSchema = z.object({
  avg: z.number().nullable(),
  p50: z.number().nullable(),
  p95: z.number().nullable(),
});
export type DurationStats = z.infer<typeof percentileSchema>;

const notModelledSchema = z.object({ modelled: z.literal(false), reason: z.string() });

/** Task statistics (the Task model exists): current stock plus completions in the range. */
export const taskStatsSchema = z.object({
  modelled: z.literal(true),
  open: z.number().int(),
  overdue: z.number().int(),
  dueToday: z.number().int(),
  createdInRange: z.number().int(),
  completedInRange: z.number().int(),
  byStatus: z.record(z.string(), z.number().int()),
  byPriority: z.record(z.string(), z.number().int()),
});
export type TaskStats = z.infer<typeof taskStatsSchema>;

// ----- business --------------------------------------------------------------------------------

export const businessAnalyticsSchema = z.object({
  generatedAt: z.string().datetime(),
  range: analyticsRangeSchema,
  contacts: z.object({ created: z.number().int(), series: z.array(countPointSchema) }),
  leads: z.object({
    /** Leads created in the range (soft-deleted excluded). */
    created: z.number().int(),
    /** Current status of the leads created in the range. */
    byStatus: z.record(LeadStatus, z.number().int()),
    bySource: z.record(LeadSource, z.number().int()),
    series: z.array(countPointSchema),
  }),
  funnel: z.object({
    /** There is no stage-history table: a lead counts as having "reached" a stage when its CURRENT status is that stage or a later one. */
    basis: z.literal('current_status_of_leads_created_in_range'),
    stages: z.array(
      z.object({
        status: LeadStatus,
        reached: z.number().int(),
        rateFromPrevious: z.number().nullable(),
        rateFromTop: z.number().nullable(),
      }),
    ),
    lost: z.number().int(),
    /** won / created, null when no leads were created. */
    conversionRate: z.number().nullable(),
  }),
  conversations: z.object({
    created: z.number().int(),
    byStatus: z.record(ConversationStatus, z.number().int()),
    byChannel: z.record(ConversationChannel, z.number().int()),
    series: z.array(countPointSchema),
  }),
  tasks: z.union([taskStatsSchema, notModelledSchema]),
});
export type BusinessAnalytics = z.infer<typeof businessAnalyticsSchema>;

// ----- sales -----------------------------------------------------------------------------------

export const salesAnalyticsSchema = z.object({
  generatedAt: z.string().datetime(),
  range: analyticsRangeSchema,
  /**
   * `true` when the organization has deals: every figure then comes from the Deal model (`basis: 'deals'`,
   * `closeDateBasis: 'closedAt'`) and `stages` lists the open pipeline by stage. `false` = no deals exist yet, the
   * figures are derived from leads that carry a `value` (`basis: 'leads_with_value'`).
   */
  dealsModelled: z.boolean(),
  basis: z.enum(['deals', 'leads_with_value']),
  /** Lead basis: `convertedAt`, else `updatedAt`. Deal basis: `closedAt`. */
  closeDateBasis: z.enum(['closedAt', 'convertedAt_or_updatedAt']),
  /** Values are never summed across currencies. */
  pipeline: z.array(
    z.object({
      status: LeadStatus,
      currency: z.string().length(3),
      count: z.number().int(),
      value: z.number(),
    }),
  ),
  closedInRange: z.array(
    z.object({
      currency: z.string().length(3),
      wonCount: z.number().int(),
      wonValue: z.number(),
      lostCount: z.number().int(),
      lostValue: z.number(),
      avgWonValue: z.number().nullable(),
    }),
  ),
  /** won / (won + lost) among leads closed in the range. */
  winRate: z.number().nullable(),
  avgSalesCycleDays: z.number().nullable(),
  bySource: z.array(
    z.object({
      source: LeadSource,
      won: z.number().int(),
      lost: z.number().int(),
      winRate: z.number().nullable(),
    }),
  ),
  wonSeries: z.array(countPointSchema),
  /**
   * Deal basis only (omitted otherwise): open deals per stage and currency across all pipelines, ordered by pipeline then stage order. `pipeline` is empty on the deal basis; `bySource` is empty
   * because deals carry no lead source.
   */
  stages: z
    .array(
      z.object({
        pipelineId: z.string().uuid(),
        pipelineName: z.string(),
        stageId: z.string().uuid(),
        stageName: z.string(),
        order: z.number().int(),
        probability: z.number().int(),
        currency: z.string().length(3),
        count: z.number().int(),
        value: z.number(),
        weightedValue: z.number(),
      }),
    )
    .optional(),
});
export type SalesAnalytics = z.infer<typeof salesAnalyticsSchema>;

// ----- agents ----------------------------------------------------------------------------------

const executionCountsSchema = z.object({
  executions: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  /** succeeded / (succeeded + failed + timed_out); cancelled/queued/running are excluded. Null when nothing finished. */
  successRate: z.number().nullable(),
});

export const agentAnalyticsSchema = z.object({
  generatedAt: z.string().datetime(),
  range: analyticsRangeSchema,
  pricingConfigured: z.boolean(),
  totals: executionCountsSchema.extend({
    byStatus: z.record(AgentExecutionStatus, z.number().int()),
    durationMs: percentileSchema,
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    totalTokens: z.number().int(),
    /** Sum of the executions that have a cost estimate; null when none has. */
    costUsd: z.number().nullable(),
    costCoverage: z.object({ priced: z.number().int(), total: z.number().int() }),
  }),
  byAgent: z.array(
    executionCountsSchema.extend({
      agentId: idSchema,
      name: z.string(),
      durationMs: percentileSchema,
      totalTokens: z.number().int(),
      costUsd: z.number().nullable(),
    }),
  ),
  series: z.array(
    z.object({
      bucket: bucketSchema,
      total: z.number().int(),
      succeeded: z.number().int(),
      failed: z.number().int(),
    }),
  ),
});
export type AgentAnalytics = z.infer<typeof agentAnalyticsSchema>;

// ----- automation ------------------------------------------------------------------------------

const runSeriesSchema = z.array(
  z.object({
    bucket: bucketSchema,
    total: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
  }),
);
const reasonSchema = z.object({ reason: z.string(), count: z.number().int() });

export const automationAnalyticsSchema = z.object({
  generatedAt: z.string().datetime(),
  range: analyticsRangeSchema,
  workflows: z.object({
    runs: z.number().int(),
    byStatus: z.record(z.string(), z.number().int()),
    successRate: z.number().nullable(),
    durationMs: percentileSchema,
    /** Top failure messages (truncated to 200 chars), most frequent first. */
    failureReasons: z.array(reasonSchema),
    byWorkflow: z.array(
      z.object({
        workflowId: idSchema,
        name: z.string(),
        runs: z.number().int(),
        succeeded: z.number().int(),
        failed: z.number().int(),
        successRate: z.number().nullable(),
      }),
    ),
    series: runSeriesSchema,
  }),
  webhooks: z.object({
    deliveries: z.number().int(),
    byStatus: z.record(z.string(), z.number().int()),
    /** delivered / (delivered + failed); pending deliveries are excluded. */
    successRate: z.number().nullable(),
    avgAttempts: z.number().nullable(),
    failureReasons: z.array(reasonSchema),
    byEvent: z.array(
      z.object({
        event: z.string(),
        total: z.number().int(),
        delivered: z.number().int(),
        failed: z.number().int(),
      }),
    ),
    series: runSeriesSchema,
  }),
});
export type AutomationAnalytics = z.infer<typeof automationAnalyticsSchema>;

// ----- usage -----------------------------------------------------------------------------------

const usageTotalsSchema = z.object({
  requests: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number().nullable(),
});

export const usageAnalyticsSchema = z.object({
  generatedAt: z.string().datetime(),
  range: analyticsRangeSchema,
  pricingConfigured: z.boolean(),
  totals: usageTotalsSchema.extend({
    successRequests: z.number().int(),
    errorRequests: z.number().int(),
    pricedRequests: z.number().int(),
  }),
  byModel: z.array(usageTotalsSchema.extend({ provider: z.string(), model: z.string() })),
  /** `agentId = null` is the assistant and other non-agent calls (embeddings, summaries). */
  byAgent: z.array(
    usageTotalsSchema.extend({ agentId: idSchema.nullable(), name: z.string().nullable() }),
  ),
  byUser: z.array(
    usageTotalsSchema.extend({ userId: idSchema.nullable(), name: z.string().nullable() }),
  ),
  series: z.array(usageTotalsSchema.extend({ bucket: bucketSchema })),
  /** Current calendar month (independent of the selected range) against plan limits and the budget. */
  currentPeriod: z.object({
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    planTokenLimit: z.number().int().nullable(),
    tokensUsed: z.number().int(),
    percentOfPlan: z.number().nullable(),
    budget: budgetStatusSchema,
  }),
});
export type UsageAnalytics = z.infer<typeof usageAnalyticsSchema>;
