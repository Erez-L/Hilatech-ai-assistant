import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';
import { PlanKey, planLimitsSchema, subscriptionSchema, SubscriptionStatus } from './platform';

// ---------------------------------------------------------------------------
// Billing readiness (Priority 5). There is NO payment provider: nothing here charges money, and the
// checkout endpoint answers 501 PAYMENT_NOT_CONFIGURED. Prices are never invented.
// ---------------------------------------------------------------------------

export const EntitlementKey = z.enum([
  'seats',
  'ai_tokens',
  'documents',
  'storage_mb',
  'agents',
  'automations',
  'agent_executions',
  'automation_runs',
]);
export type EntitlementKey = z.infer<typeof EntitlementKey>;

export const EntitlementState = z.enum(['ok', 'warning', 'exceeded']);
export type EntitlementState = z.infer<typeof EntitlementState>;

/** Percentage of a limit at which an entitlement is reported as `warning`. */
export const ENTITLEMENT_WARNING_PCT = 80;

export const entitlementUsageSchema = z.object({
  key: EntitlementKey,
  label: z.string(),
  unit: z.enum(['count', 'tokens', 'mb']),
  used: z.number(),
  /** null = the plan defines no cap for this entitlement. */
  limit: z.number().nullable(),
  percent: z.number().nullable(),
  state: EntitlementState,
  /** `stock` = what the organization holds right now (members, documents…); `period` = consumed this calendar month. */
  basis: z.enum(['stock', 'period']),
  /** True when the API refuses to go past the limit (402 ENTITLEMENT_EXCEEDED); false = reported only. */
  enforced: z.boolean(),
});
export type EntitlementUsage = z.infer<typeof entitlementUsageSchema>;

export const entitlementsOverviewSchema = z.object({
  plan: PlanKey,
  status: SubscriptionStatus,
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  entitlements: z.array(entitlementUsageSchema),
});
export type EntitlementsOverview = z.infer<typeof entitlementsOverviewSchema>;

// ----- plan catalogue ---------------------------------------------------------------------------

export const planCatalogEntrySchema = z.object({
  key: PlanKey,
  name: z.string(),
  /** Ascending order of plans (free = 0). */
  rank: z.number().int(),
  limits: planLimitsSchema,
  /** No prices are defined in this system; present so the UI can show "contact us" honestly. */
  pricing: z.object({ configured: z.literal(false), note: z.string() }),
});
export type PlanCatalogEntry = z.infer<typeof planCatalogEntrySchema>;

// ----- budget ----------------------------------------------------------------------------------

export const budgetSettingsSchema = z.object({
  /** Monthly AI token budget (input + output); null = no token budget. */
  monthlyTokenBudget: z.number().int().positive().nullable(),
  /** Monthly AI cost budget in USD; only enforceable where model pricing is configured. */
  monthlyCostBudgetUsd: z.number().positive().nullable(),
  /** 1-100: percentage of a budget at which a warning alert is raised. */
  warnThresholdPct: z.number().int().min(1).max(100),
  /** When true, AI requests are refused with 402 BUDGET_EXCEEDED once a budget is used up. */
  hardStopEnabled: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
  updatedById: idSchema.nullable(),
});
export type BudgetSettings = z.infer<typeof budgetSettingsSchema>;

export const updateBudgetRequestSchema = z
  .object({
    monthlyTokenBudget: z.number().int().positive().max(1_000_000_000_000).nullable().optional(),
    monthlyCostBudgetUsd: z.number().positive().max(100_000_000).nullable().optional(),
    warnThresholdPct: z.number().int().min(1).max(100).optional(),
    hardStopEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
export type UpdateBudgetRequest = z.infer<typeof updateBudgetRequestSchema>;

export const BudgetLevel = z.enum(['ok', 'warning', 'exceeded']);
export type BudgetLevel = z.infer<typeof BudgetLevel>;

export const budgetStatusSchema = z.object({
  settings: budgetSettingsSchema,
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  tokens: z.object({
    used: z.number(),
    budget: z.number().nullable(),
    percent: z.number().nullable(),
    level: BudgetLevel,
  }),
  cost: z.object({
    usedUsd: z.number().nullable(),
    budgetUsd: z.number().nullable(),
    percent: z.number().nullable(),
    level: BudgetLevel,
    /** false when a cost budget is set but no model pricing is configured: the budget cannot be measured or enforced. */
    enforceable: z.boolean(),
    pricedRequests: z.number().int(),
    unpricedRequests: z.number().int(),
    note: z.string().nullable(),
  }),
  /** True when hard stop is on and at least one budget is used up: new AI requests are refused. */
  blocked: z.boolean(),
});
export type BudgetStatus = z.infer<typeof budgetStatusSchema>;

export const BudgetAlertScope = z.enum(['budget_tokens', 'budget_cost', 'plan_tokens']);
export type BudgetAlertScope = z.infer<typeof BudgetAlertScope>;
export const BudgetAlertKind = z.enum(['warning', 'exceeded']);
export type BudgetAlertKind = z.infer<typeof BudgetAlertKind>;

export const budgetAlertSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  periodStart: z.string().datetime(),
  scope: BudgetAlertScope,
  kind: BudgetAlertKind,
  used: z.number(),
  limit: z.number(),
  thresholdPct: z.number().int(),
  createdAt: z.string().datetime(),
});
export type BudgetAlert = z.infer<typeof budgetAlertSchema>;

export const listBudgetAlertsQuerySchema = paginationQuerySchema;
export type ListBudgetAlertsQuery = z.infer<typeof listBudgetAlertsQuerySchema>;

// ----- upgrade flow (data only) ------------------------------------------------------------------

export const upgradeOptionSchema = z.object({
  plan: planCatalogEntrySchema,
  /** Per limit: the target plan's value minus the current plan's value. */
  limitDeltas: z.record(z.string(), z.number()),
  /** Entitlements currently at `warning`/`exceeded` that this plan's limits would bring back under the warning level. */
  resolves: z.array(EntitlementKey),
});
export type UpgradeOption = z.infer<typeof upgradeOptionSchema>;

export const upgradeOptionsSchema = z.object({
  currentPlan: PlanKey,
  subscriptionStatus: subscriptionSchema.shape.status,
  /** Entitlements at `warning` or `exceeded`, most pressing first. */
  pressure: z.array(entitlementUsageSchema),
  options: z.array(upgradeOptionSchema),
  payment: z.object({
    configured: z.literal(false),
    provider: z.null(),
    message: z.string(),
  }),
});
export type UpgradeOptions = z.infer<typeof upgradeOptionsSchema>;

export const checkoutRequestSchema = z.object({ plan: PlanKey }).strict();
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
