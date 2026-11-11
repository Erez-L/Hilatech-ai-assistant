import { z } from 'zod';
import { ConversationChannel, ConversationStatus, LeadSource, LeadStatus } from './crm';

// ---------------------------------------------------------------------------
// Dashboard summary — every number is computed live from the organization's data.
// ---------------------------------------------------------------------------

export const dashboardPeriodSchema = z.enum(['7d', '30d', '90d']);
export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;

export const dashboardQuerySchema = z.object({ period: dashboardPeriodSchema.default('30d') });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const dashboardSummarySchema = z.object({
  generatedAt: z.string().datetime(),
  period: z.object({
    key: dashboardPeriodSchema,
    from: z.string().datetime(),
    to: z.string().datetime(),
  }),
  members: z.object({ active: z.number().int(), suspended: z.number().int() }),
  invitations: z.object({ pending: z.number().int() }),
  contacts: z.object({ total: z.number().int(), newInPeriod: z.number().int() }),
  leads: z.object({
    total: z.number().int(),
    open: z.number().int(),
    newInPeriod: z.number().int(),
    wonInPeriod: z.number().int(),
    lostInPeriod: z.number().int(),
    byStatus: z.partialRecord(LeadStatus, z.number().int()),
    bySource: z.partialRecord(LeadSource, z.number().int()),
    /** Sum of `value` over open leads (not won/lost), in the organization's reporting currency. */
    pipelineValue: z.number(),
    wonValueInPeriod: z.number(),
    currency: z.string().length(3),
    /** `deals` when the organization has deals (then `pipelineValue` / `wonValueInPeriod` come from them), else `leads`. */
    valueBasis: z.enum(['deals', 'leads']).optional(),
  }),
  /** Present when the organization has at least one deal. Sums are in the reporting currency only (other currencies are listed separately). */
  deals: z
    .object({
      open: z.number().int(),
      wonInPeriod: z.number().int(),
      lostInPeriod: z.number().int(),
      pipelineValue: z.number(),
      weightedPipelineValue: z.number(),
      wonValueInPeriod: z.number(),
      currency: z.string().length(3),
      otherCurrencies: z.array(
        z.object({ currency: z.string().length(3), pipelineValue: z.number() }),
      ),
    })
    .optional(),
  tasks: z
    .object({ open: z.number().int(), overdue: z.number().int(), dueToday: z.number().int() })
    .optional(),
  conversations: z.object({
    total: z.number().int(),
    open: z.number().int(),
    pending: z.number().int(),
    unassigned: z.number().int(),
    newInPeriod: z.number().int(),
    byStatus: z.partialRecord(ConversationStatus, z.number().int()),
    byChannel: z.partialRecord(ConversationChannel, z.number().int()),
  }),
  /** Daily series over the period for sparklines/charts: ISO date (YYYY-MM-DD) → count. */
  series: z.object({
    leadsCreated: z.array(z.object({ date: z.string(), count: z.number().int() })),
    conversationsCreated: z.array(z.object({ date: z.string(), count: z.number().int() })),
  }),
  recentLeads: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      status: LeadStatus,
      value: z.number().nullable(),
      currency: z.string().length(3),
      createdAt: z.string().datetime(),
    }),
  ),
  recentConversations: z.array(
    z.object({
      id: z.string().uuid(),
      subject: z.string().nullable(),
      status: ConversationStatus,
      channel: ConversationChannel,
      lastMessageAt: z.string().datetime().nullable(),
    }),
  ),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
