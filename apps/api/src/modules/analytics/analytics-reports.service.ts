import { PricingTable } from '@hilatech/ai-engine';
import {
  type AgentAnalytics,
  AgentExecutionStatus,
  type AnalyticsExportQuery,
  type AnalyticsRange,
  type AnalyticsRangeQuery,
  type AutomationAnalytics,
  type BusinessAnalytics,
  ConversationChannel,
  ConversationStatus,
  LeadSource,
  LeadStatus,
  type SalesAnalytics,
  type TaskStats,
  type UsageAnalytics,
} from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import { monthPeriod } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BudgetService } from '../billing/budget.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { percentOf } from '../billing/budget.rules';
import {
  type ResolvedRange,
  buildFunnel,
  fillSeries,
  num,
  numOrNull,
  rate,
  resolveRange,
  roundMs,
  toCsv,
} from './analytics-reports.helpers';

const TOP_N = 50;
const REASONS_N = 10;
const REASON_CHARS = Prisma.raw('200');

const zeroRecord = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/**
 * Org-scoped analytics reports. Every query is a single parameterised aggregate that starts with
 * `"organizationId" = $1` and a createdAt range, so it rides the existing
 * (organizationId, createdAt) / (organizationId, status) indexes. Table and column names are
 * compile-time constants; only the organization id and the range bounds are bound parameters.
 */
@Injectable()
export class AnalyticsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingTable,
    private readonly entitlements: EntitlementsService,
    private readonly budget: BudgetService,
  ) {}

  private rangeDto(range: ResolvedRange): AnalyticsRange {
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      granularity: range.granularity,
      buckets: range.buckets.length,
    };
  }

  /** `date_trunc` unit from the validated granularity enum (never from raw input). */
  private unit(range: ResolvedRange): Prisma.Sql {
    return Prisma.raw(`'${range.granularity}'`);
  }

  // ---------------------------------------------------------------------------------------------
  // Business
  // ---------------------------------------------------------------------------------------------

  async business(tenant: TenantContext, query: AnalyticsRangeQuery): Promise<BusinessAnalytics> {
    const range = resolveRange(query);
    const org = tenant.organizationId;
    const unit = this.unit(range);
    const db = this.prisma.client;

    const [leadGroups, leadSeries, contactSeries, convGroups, convSeries] = await Promise.all([
      db.$queryRaw<Array<{ status: LeadStatus; source: LeadSource; n: number }>>`
        SELECT "status"::text AS status, "source"::text AS source, COUNT(*)::int AS n
        FROM "Lead"
        WHERE "organizationId" = ${org}::uuid AND "deletedAt" IS NULL
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1, 2`,
      db.$queryRaw<Array<{ bucket: Date; n: number }>>`
        SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::int AS n
        FROM "Lead"
        WHERE "organizationId" = ${org}::uuid AND "deletedAt" IS NULL
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1`,
      db.$queryRaw<Array<{ bucket: Date; n: number }>>`
        SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::int AS n
        FROM "Contact"
        WHERE "organizationId" = ${org}::uuid AND "deletedAt" IS NULL
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1`,
      db.$queryRaw<Array<{ status: ConversationStatus; channel: ConversationChannel; n: number }>>`
        SELECT "status"::text AS status, "channel"::text AS channel, COUNT(*)::int AS n
        FROM "Conversation"
        WHERE "organizationId" = ${org}::uuid
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1, 2`,
      db.$queryRaw<Array<{ bucket: Date; n: number }>>`
        SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::int AS n
        FROM "Conversation"
        WHERE "organizationId" = ${org}::uuid
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1`,
    ]);

    const byStatus = zeroRecord(LeadStatus.options);
    const bySource = zeroRecord(LeadSource.options);
    for (const row of leadGroups) {
      byStatus[row.status] += row.n;
      bySource[row.source] += row.n;
    }
    const convStatus = zeroRecord(ConversationStatus.options);
    const convChannel = zeroRecord(ConversationChannel.options);
    for (const row of convGroups) {
      convStatus[row.status] += row.n;
      convChannel[row.channel] += row.n;
    }
    const countSeries = (rows: Array<{ bucket: Date; n: number }>) =>
      fillSeries<{ bucket: Date; n: number }, { bucket: string; count: number }>(
        range.buckets,
        rows,
        (row) => ({ count: row?.n ?? 0 }),
      );
    const sum = (record: Record<string, number>) =>
      Object.values(record).reduce((a, b) => a + b, 0);

    return {
      generatedAt: new Date().toISOString(),
      range: this.rangeDto(range),
      contacts: {
        created: contactSeries.reduce((a, r) => a + r.n, 0),
        series: countSeries(contactSeries),
      },
      leads: {
        created: sum(byStatus),
        byStatus,
        bySource,
        series: countSeries(leadSeries),
      },
      funnel: { basis: 'current_status_of_leads_created_in_range', ...buildFunnel(byStatus) },
      conversations: {
        created: sum(convStatus),
        byStatus: convStatus,
        byChannel: convChannel,
        series: countSeries(convSeries),
      },
      tasks: await this.taskStats(org, range),
    };
  }

  /** Task stock (open / overdue / due today, by status and priority) plus creations and completions in the range. */
  private async taskStats(org: string, range: ResolvedRange): Promise<TaskStats> {
    const db = this.prisma.client;
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const open = { in: ['todo', 'in_progress'] as Array<'todo' | 'in_progress'> };
    const [byStatus, byPriority, overdue, dueToday, createdInRange, completedInRange] =
      await Promise.all([
        db.task.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
        db.task.groupBy({
          by: ['priority'],
          where: { organizationId: org, status: open },
          _count: { _all: true },
        }),
        db.task.count({ where: { organizationId: org, status: open, dueAt: { lt: now } } }),
        db.task.count({
          where: { organizationId: org, status: open, dueAt: { gte: dayStart, lt: dayEnd } },
        }),
        db.task.count({
          where: { organizationId: org, createdAt: { gte: range.from, lt: range.to } },
        }),
        db.task.count({
          where: {
            organizationId: org,
            status: 'done',
            completedAt: { gte: range.from, lt: range.to },
          },
        }),
      ]);
    const statusCounts = zeroRecord(['todo', 'in_progress', 'done', 'cancelled'] as const);
    for (const r of byStatus) statusCounts[r.status] = r._count._all;
    const priorityCounts = zeroRecord(['low', 'medium', 'high', 'urgent'] as const);
    for (const r of byPriority) priorityCounts[r.priority] = r._count._all;
    return {
      modelled: true,
      open: statusCounts.todo + statusCounts.in_progress,
      overdue,
      dueToday,
      createdInRange,
      completedInRange,
      byStatus: statusCounts,
      byPriority: priorityCounts,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Sales (real deals when the organization has any, otherwise derived from leads that carry a value)
  // ---------------------------------------------------------------------------------------------

  async sales(tenant: TenantContext, query: AnalyticsRangeQuery): Promise<SalesAnalytics> {
    const range = resolveRange(query);
    const org = tenant.organizationId;
    const unit = this.unit(range);
    const db = this.prisma.client;
    if ((await db.deal.count({ where: { organizationId: org } })) > 0) {
      return this.salesFromDeals(org, range, unit);
    }
    // Closing moment of a won/lost lead: convertedAt, else updatedAt (there is no closedAt column).
    const [pipeline, closed, cycle, sourceRows, wonSeries] = await Promise.all([
      db.$queryRaw<Array<{ status: LeadStatus; currency: string; n: number; value: number }>>`
        SELECT "status"::text AS status, "currency" AS currency, COUNT(*)::int AS n,
               COALESCE(SUM("value"), 0)::float8 AS value
        FROM "Lead"
        WHERE "organizationId" = ${org}::uuid AND "deletedAt" IS NULL
          AND "status" IN ('new', 'contacted', 'qualified', 'proposal')
        GROUP BY 1, 2 ORDER BY 1, 2`,
      db.$queryRaw<Array<{ status: LeadStatus; currency: string; n: number; value: number }>>`
        SELECT "status"::text AS status, "currency" AS currency, COUNT(*)::int AS n,
               COALESCE(SUM("value"), 0)::float8 AS value
        FROM "Lead"
        WHERE "organizationId" = ${org}::uuid AND "deletedAt" IS NULL
          AND "status" IN ('won', 'lost')
          AND COALESCE("convertedAt", "updatedAt") >= ${range.from}
          AND COALESCE("convertedAt", "updatedAt") < ${range.to}
        GROUP BY 1, 2 ORDER BY 2, 1`,
      db.$queryRaw<Array<{ days: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (COALESCE("convertedAt", "updatedAt") - "createdAt")) / 86400)::float8 AS days
        FROM "Lead"
        WHERE "organizationId" = ${org}::uuid AND "deletedAt" IS NULL AND "status" = 'won'
          AND COALESCE("convertedAt", "updatedAt") >= ${range.from}
          AND COALESCE("convertedAt", "updatedAt") < ${range.to}`,
      db.$queryRaw<Array<{ source: LeadSource; status: LeadStatus; n: number }>>`
        SELECT "source"::text AS source, "status"::text AS status, COUNT(*)::int AS n
        FROM "Lead"
        WHERE "organizationId" = ${org}::uuid AND "deletedAt" IS NULL
          AND "status" IN ('won', 'lost')
          AND COALESCE("convertedAt", "updatedAt") >= ${range.from}
          AND COALESCE("convertedAt", "updatedAt") < ${range.to}
        GROUP BY 1, 2`,
      db.$queryRaw<Array<{ bucket: Date; n: number }>>`
        SELECT date_trunc(${unit}, COALESCE("convertedAt", "updatedAt")) AS bucket, COUNT(*)::int AS n
        FROM "Lead"
        WHERE "organizationId" = ${org}::uuid AND "deletedAt" IS NULL AND "status" = 'won'
          AND COALESCE("convertedAt", "updatedAt") >= ${range.from}
          AND COALESCE("convertedAt", "updatedAt") < ${range.to}
        GROUP BY 1`,
    ]);

    const currencies = new Map<
      string,
      { wonCount: number; wonValue: number; lostCount: number; lostValue: number }
    >();
    let won = 0;
    let lost = 0;
    for (const row of closed) {
      const entry = currencies.get(row.currency) ?? {
        wonCount: 0,
        wonValue: 0,
        lostCount: 0,
        lostValue: 0,
      };
      if (row.status === 'won') {
        entry.wonCount += row.n;
        entry.wonValue += num(row.value);
        won += row.n;
      } else {
        entry.lostCount += row.n;
        entry.lostValue += num(row.value);
        lost += row.n;
      }
      currencies.set(row.currency, entry);
    }
    const sourceMap = new Map<LeadSource, { won: number; lost: number }>();
    for (const row of sourceRows) {
      const entry = sourceMap.get(row.source) ?? { won: 0, lost: 0 };
      if (row.status === 'won') entry.won += row.n;
      else entry.lost += row.n;
      sourceMap.set(row.source, entry);
    }
    const cycleDays = numOrNull(cycle[0]?.days);

    return {
      generatedAt: new Date().toISOString(),
      range: this.rangeDto(range),
      dealsModelled: false,
      basis: 'leads_with_value',
      closeDateBasis: 'convertedAt_or_updatedAt',
      pipeline: pipeline.map((r) => ({
        status: r.status,
        currency: r.currency,
        count: r.n,
        value: num(r.value),
      })),
      closedInRange: [...currencies.entries()].map(([currency, v]) => ({
        currency,
        ...v,
        avgWonValue: v.wonCount > 0 ? Math.round((v.wonValue / v.wonCount) * 100) / 100 : null,
      })),
      winRate: rate(won, won + lost),
      avgSalesCycleDays: cycleDays === null ? null : Math.round(cycleDays * 10) / 10,
      bySource: [...sourceMap.entries()]
        .map(([source, v]) => ({ source, ...v, winRate: rate(v.won, v.won + v.lost) }))
        .sort((a, b) => b.won + b.lost - (a.won + a.lost)),
      wonSeries: fillSeries<{ bucket: Date; n: number }, { bucket: string; count: number }>(
        range.buckets,
        wonSeries,
        (row) => ({ count: row?.n ?? 0 }),
      ),
    };
  }

  private async salesFromDeals(
    org: string,
    range: ResolvedRange,
    unit: Prisma.Sql,
  ): Promise<SalesAnalytics> {
    const db = this.prisma.client;
    const [stageRows, closed, cycle, wonSeries] = await Promise.all([
      db.$queryRaw<
        Array<{
          pipelineId: string;
          pipelineName: string;
          stageId: string;
          stageName: string;
          order: number;
          probability: number;
          currency: string;
          n: number;
          value: number;
        }>
      >`
        SELECT p."id" AS "pipelineId", p."name" AS "pipelineName", s."id" AS "stageId", s."name" AS "stageName",
               s."order" AS "order", s."probability" AS probability, d."currency" AS currency,
               COUNT(*)::int AS n, COALESCE(SUM(d."value"), 0)::float8 AS value
        FROM "Deal" d
        JOIN "PipelineStage" s ON s."id" = d."stageId"
        JOIN "Pipeline" p ON p."id" = d."pipelineId"
        WHERE d."organizationId" = ${org}::uuid AND d."status" = 'open'
        GROUP BY p."id", p."name", p."isDefault", s."id", s."name", s."order", s."probability", d."currency"
        ORDER BY p."isDefault" DESC, p."name", s."order", d."currency"`,
      db.$queryRaw<Array<{ status: 'won' | 'lost'; currency: string; n: number; value: number }>>`
        SELECT "status"::text AS status, "currency" AS currency, COUNT(*)::int AS n,
               COALESCE(SUM("value"), 0)::float8 AS value
        FROM "Deal"
        WHERE "organizationId" = ${org}::uuid AND "status" IN ('won', 'lost')
          AND "closedAt" >= ${range.from} AND "closedAt" < ${range.to}
        GROUP BY 1, 2 ORDER BY 2, 1`,
      db.$queryRaw<Array<{ days: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400)::float8 AS days
        FROM "Deal"
        WHERE "organizationId" = ${org}::uuid AND "status" = 'won'
          AND "closedAt" >= ${range.from} AND "closedAt" < ${range.to}`,
      db.$queryRaw<Array<{ bucket: Date; n: number }>>`
        SELECT date_trunc(${unit}, "closedAt") AS bucket, COUNT(*)::int AS n
        FROM "Deal"
        WHERE "organizationId" = ${org}::uuid AND "status" = 'won'
          AND "closedAt" >= ${range.from} AND "closedAt" < ${range.to}
        GROUP BY 1`,
    ]);
    const currencies = new Map<
      string,
      { wonCount: number; wonValue: number; lostCount: number; lostValue: number }
    >();
    let won = 0;
    let lost = 0;
    for (const row of closed) {
      const entry = currencies.get(row.currency) ?? {
        wonCount: 0,
        wonValue: 0,
        lostCount: 0,
        lostValue: 0,
      };
      if (row.status === 'won') {
        entry.wonCount += row.n;
        entry.wonValue += num(row.value);
        won += row.n;
      } else {
        entry.lostCount += row.n;
        entry.lostValue += num(row.value);
        lost += row.n;
      }
      currencies.set(row.currency, entry);
    }
    const cycleDays = numOrNull(cycle[0]?.days);
    return {
      generatedAt: new Date().toISOString(),
      range: this.rangeDto(range),
      dealsModelled: true,
      basis: 'deals',
      closeDateBasis: 'closedAt',
      pipeline: [],
      closedInRange: [...currencies.entries()].map(([currency, v]) => ({
        currency,
        ...v,
        avgWonValue: v.wonCount > 0 ? Math.round((v.wonValue / v.wonCount) * 100) / 100 : null,
      })),
      winRate: rate(won, won + lost),
      avgSalesCycleDays: cycleDays === null ? null : Math.round(cycleDays * 10) / 10,
      bySource: [],
      wonSeries: fillSeries<{ bucket: Date; n: number }, { bucket: string; count: number }>(
        range.buckets,
        wonSeries,
        (row) => ({ count: row?.n ?? 0 }),
      ),
      stages: stageRows.map((r) => {
        const value = Math.round(num(r.value) * 100) / 100;
        return {
          pipelineId: r.pipelineId,
          pipelineName: r.pipelineName,
          stageId: r.stageId,
          stageName: r.stageName,
          order: r.order,
          probability: r.probability,
          currency: r.currency,
          count: r.n,
          value,
          weightedValue: Math.round(((value * r.probability) / 100) * 100) / 100,
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Agent performance
  // ---------------------------------------------------------------------------------------------

  async agents(tenant: TenantContext, query: AnalyticsRangeQuery): Promise<AgentAnalytics> {
    const range = resolveRange(query);
    const org = tenant.organizationId;
    const unit = this.unit(range);
    const db = this.prisma.client;
    type StatsRow = {
      n: number;
      succeeded: number;
      failed: number;
      finished: number;
      input_tokens: number;
      output_tokens: number;
      cost: number | null;
      priced: number;
      avg_ms: number | null;
      p50_ms: number | null;
      p95_ms: number | null;
    };
    const [byStatus, totals, perAgent, series] = await Promise.all([
      db.$queryRaw<Array<{ status: AgentExecutionStatus; n: number }>>`
        SELECT "status"::text AS status, COUNT(*)::int AS n
        FROM "AgentExecution"
        WHERE "organizationId" = ${org}::uuid
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1`,
      db.$queryRaw<StatsRow[]>`
        SELECT COUNT(*)::int AS n,
               (COUNT(*) FILTER (WHERE "status" = 'succeeded'))::int AS succeeded,
               (COUNT(*) FILTER (WHERE "status" IN ('failed', 'timed_out')))::int AS failed,
               (COUNT(*) FILTER (WHERE "status" IN ('succeeded', 'failed', 'timed_out')))::int AS finished,
               COALESCE(SUM("inputTokens"), 0)::float8 AS input_tokens,
               COALESCE(SUM("outputTokens"), 0)::float8 AS output_tokens,
               SUM("estimatedCostUsd")::float8 AS cost,
               COUNT("estimatedCostUsd")::int AS priced,
               AVG("durationMs")::float8 AS avg_ms,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS p50_ms,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95_ms
        FROM "AgentExecution"
        WHERE "organizationId" = ${org}::uuid
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}`,
      db.$queryRaw<Array<StatsRow & { agent_id: string; name: string }>>`
        SELECT e."agentId" AS agent_id, a."name" AS name, COUNT(*)::int AS n,
               (COUNT(*) FILTER (WHERE e."status" = 'succeeded'))::int AS succeeded,
               (COUNT(*) FILTER (WHERE e."status" IN ('failed', 'timed_out')))::int AS failed,
               (COUNT(*) FILTER (WHERE e."status" IN ('succeeded', 'failed', 'timed_out')))::int AS finished,
               COALESCE(SUM(e."inputTokens"), 0)::float8 AS input_tokens,
               COALESCE(SUM(e."outputTokens"), 0)::float8 AS output_tokens,
               SUM(e."estimatedCostUsd")::float8 AS cost,
               COUNT(e."estimatedCostUsd")::int AS priced,
               AVG(e."durationMs")::float8 AS avg_ms,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY e."durationMs") AS p50_ms,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY e."durationMs") AS p95_ms
        FROM "AgentExecution" e
        JOIN "Agent" a ON a."id" = e."agentId" AND a."organizationId" = e."organizationId"
        WHERE e."organizationId" = ${org}::uuid
          AND e."createdAt" >= ${range.from} AND e."createdAt" < ${range.to}
        GROUP BY e."agentId", a."name"
        ORDER BY n DESC, a."name"
        LIMIT ${TOP_N}`,
      db.$queryRaw<Array<{ bucket: Date; total: number; succeeded: number; failed: number }>>`
        SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::int AS total,
               (COUNT(*) FILTER (WHERE "status" = 'succeeded'))::int AS succeeded,
               (COUNT(*) FILTER (WHERE "status" IN ('failed', 'timed_out')))::int AS failed
        FROM "AgentExecution"
        WHERE "organizationId" = ${org}::uuid
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1`,
    ]);

    const statusCounts = zeroRecord(AgentExecutionStatus.options);
    for (const row of byStatus) statusCounts[row.status] += row.n;
    const t = totals[0];
    const inputTokens = num(t?.input_tokens);
    const outputTokens = num(t?.output_tokens);
    return {
      generatedAt: new Date().toISOString(),
      range: this.rangeDto(range),
      pricingConfigured: this.pricing.size() > 0,
      totals: {
        executions: num(t?.n),
        succeeded: num(t?.succeeded),
        failed: num(t?.failed),
        successRate: rate(num(t?.succeeded), num(t?.finished)),
        byStatus: statusCounts,
        durationMs: { avg: roundMs(t?.avg_ms), p50: roundMs(t?.p50_ms), p95: roundMs(t?.p95_ms) },
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: numOrNull(t?.cost),
        costCoverage: { priced: num(t?.priced), total: num(t?.n) },
      },
      byAgent: perAgent.map((r) => ({
        agentId: r.agent_id,
        name: r.name,
        executions: num(r.n),
        succeeded: num(r.succeeded),
        failed: num(r.failed),
        successRate: rate(num(r.succeeded), num(r.finished)),
        durationMs: { avg: roundMs(r.avg_ms), p50: roundMs(r.p50_ms), p95: roundMs(r.p95_ms) },
        totalTokens: num(r.input_tokens) + num(r.output_tokens),
        costUsd: numOrNull(r.cost),
      })),
      series: fillSeries<
        { bucket: Date; total: number; succeeded: number; failed: number },
        { bucket: string; total: number; succeeded: number; failed: number }
      >(range.buckets, series, (row) => ({
        total: row?.total ?? 0,
        succeeded: row?.succeeded ?? 0,
        failed: row?.failed ?? 0,
      })),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Automation
  // ---------------------------------------------------------------------------------------------

  async automation(
    tenant: TenantContext,
    query: AnalyticsRangeQuery,
  ): Promise<AutomationAnalytics> {
    const range = resolveRange(query);
    const org = tenant.organizationId;
    const unit = this.unit(range);
    const db = this.prisma.client;
    type SeriesRow = { bucket: Date; total: number; succeeded: number; failed: number };
    const [
      runStatus,
      runStats,
      runReasons,
      perWorkflow,
      runSeries,
      hookStatus,
      hookStats,
      hookReasons,
      hookEvents,
      hookSeries,
    ] = await Promise.all([
      db.$queryRaw<Array<{ status: string; n: number }>>`
        SELECT "status"::text AS status, COUNT(*)::int AS n FROM "WorkflowExecution"
        WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1`,
      db.$queryRaw<Array<{ avg_ms: number | null; p50_ms: number | null; p95_ms: number | null }>>`
        SELECT AVG("durationMs")::float8 AS avg_ms,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS p50_ms,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95_ms
        FROM "WorkflowExecution"
        WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}`,
      db.$queryRaw<Array<{ reason: string; n: number }>>`
        SELECT left("error", ${REASON_CHARS}) AS reason, COUNT(*)::int AS n
        FROM "WorkflowExecution"
        WHERE "organizationId" = ${org}::uuid AND "status" = 'failed' AND "error" IS NOT NULL
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1 ORDER BY n DESC, reason LIMIT ${REASONS_N}`,
      db.$queryRaw<
        Array<{ workflow_id: string; name: string; n: number; succeeded: number; failed: number }>
      >`
        SELECT e."workflowId" AS workflow_id, w."name" AS name, COUNT(*)::int AS n,
               (COUNT(*) FILTER (WHERE e."status" = 'succeeded'))::int AS succeeded,
               (COUNT(*) FILTER (WHERE e."status" = 'failed'))::int AS failed
        FROM "WorkflowExecution" e
        JOIN "Workflow" w ON w."id" = e."workflowId" AND w."organizationId" = e."organizationId"
        WHERE e."organizationId" = ${org}::uuid
          AND e."createdAt" >= ${range.from} AND e."createdAt" < ${range.to}
        GROUP BY e."workflowId", w."name" ORDER BY n DESC, w."name" LIMIT ${TOP_N}`,
      db.$queryRaw<SeriesRow[]>`
        SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::int AS total,
               (COUNT(*) FILTER (WHERE "status" = 'succeeded'))::int AS succeeded,
               (COUNT(*) FILTER (WHERE "status" = 'failed'))::int AS failed
        FROM "WorkflowExecution"
        WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1`,
      db.$queryRaw<Array<{ status: string; n: number }>>`
        SELECT "status"::text AS status, COUNT(*)::int AS n FROM "WebhookDelivery"
        WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1`,
      db.$queryRaw<Array<{ avg_attempts: number | null }>>`
        SELECT AVG("attempts")::float8 AS avg_attempts FROM "WebhookDelivery"
        WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}`,
      db.$queryRaw<Array<{ reason: string; n: number }>>`
        SELECT COALESCE(left("lastError", ${REASON_CHARS}), 'HTTP ' || COALESCE("responseStatus"::text, 'unknown')) AS reason,
               COUNT(*)::int AS n
        FROM "WebhookDelivery"
        WHERE "organizationId" = ${org}::uuid AND "status" = 'failed'
          AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1 ORDER BY n DESC, reason LIMIT ${REASONS_N}`,
      db.$queryRaw<Array<{ event: string; n: number; delivered: number; failed: number }>>`
        SELECT "event" AS event, COUNT(*)::int AS n,
               (COUNT(*) FILTER (WHERE "status" = 'delivered'))::int AS delivered,
               (COUNT(*) FILTER (WHERE "status" = 'failed'))::int AS failed
        FROM "WebhookDelivery"
        WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1 ORDER BY n DESC, event LIMIT ${TOP_N}`,
      db.$queryRaw<SeriesRow[]>`
        SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::int AS total,
               (COUNT(*) FILTER (WHERE "status" = 'delivered'))::int AS succeeded,
               (COUNT(*) FILTER (WHERE "status" = 'failed'))::int AS failed
        FROM "WebhookDelivery"
        WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1`,
    ]);

    const toRecord = (rows: Array<{ status: string; n: number }>) =>
      Object.fromEntries(rows.map((r) => [r.status, r.n]));
    const runCounts = toRecord(runStatus);
    const hookCounts = toRecord(hookStatus);
    const sumValues = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    const series = (rows: SeriesRow[]) =>
      fillSeries<SeriesRow, { bucket: string; total: number; succeeded: number; failed: number }>(
        range.buckets,
        rows,
        (row) => ({
          total: row?.total ?? 0,
          succeeded: row?.succeeded ?? 0,
          failed: row?.failed ?? 0,
        }),
      );
    const rs = runStats[0];

    return {
      generatedAt: new Date().toISOString(),
      range: this.rangeDto(range),
      workflows: {
        runs: sumValues(runCounts),
        byStatus: runCounts,
        successRate: rate(
          runCounts.succeeded ?? 0,
          (runCounts.succeeded ?? 0) + (runCounts.failed ?? 0),
        ),
        durationMs: {
          avg: roundMs(rs?.avg_ms),
          p50: roundMs(rs?.p50_ms),
          p95: roundMs(rs?.p95_ms),
        },
        failureReasons: runReasons.map((r) => ({ reason: r.reason, count: r.n })),
        byWorkflow: perWorkflow.map((r) => ({
          workflowId: r.workflow_id,
          name: r.name,
          runs: r.n,
          succeeded: r.succeeded,
          failed: r.failed,
          successRate: rate(r.succeeded, r.succeeded + r.failed),
        })),
        series: series(runSeries),
      },
      webhooks: {
        deliveries: sumValues(hookCounts),
        byStatus: hookCounts,
        successRate: rate(
          hookCounts.delivered ?? 0,
          (hookCounts.delivered ?? 0) + (hookCounts.failed ?? 0),
        ),
        avgAttempts: (() => {
          const v = numOrNull(hookStats[0]?.avg_attempts);
          return v === null ? null : Math.round(v * 100) / 100;
        })(),
        failureReasons: hookReasons.map((r) => ({ reason: r.reason, count: r.n })),
        byEvent: hookEvents.map((r) => ({
          event: r.event,
          total: r.n,
          delivered: r.delivered,
          failed: r.failed,
        })),
        series: series(hookSeries),
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Usage (AI requests / tokens) against plan limits
  // ---------------------------------------------------------------------------------------------

  async usage(tenant: TenantContext, query: AnalyticsRangeQuery): Promise<UsageAnalytics> {
    const range = resolveRange(query);
    const org = tenant.organizationId;
    const unit = this.unit(range);
    const db = this.prisma.client;
    type Agg = {
      n: number;
      input_tokens: number;
      output_tokens: number;
      cost: number | null;
    };
    const [totals, byModel, byAgent, byUser, series, tokensUsed, limits, budget] =
      await Promise.all([
        db.$queryRaw<Array<Agg & { ok: number; errors: number; priced: number }>>`
          SELECT COUNT(*)::int AS n,
                 (COUNT(*) FILTER (WHERE "status" = 'success'))::int AS ok,
                 (COUNT(*) FILTER (WHERE "status" <> 'success'))::int AS errors,
                 COALESCE(SUM("inputTokens"), 0)::float8 AS input_tokens,
                 COALESCE(SUM("outputTokens"), 0)::float8 AS output_tokens,
                 SUM("estimatedCostUsd")::float8 AS cost,
                 COUNT("estimatedCostUsd")::int AS priced
          FROM "AiRequestLog"
          WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}`,
        db.$queryRaw<Array<Agg & { provider: string; model: string }>>`
          SELECT "provider"::text AS provider, "model" AS model, COUNT(*)::int AS n,
                 COALESCE(SUM("inputTokens"), 0)::float8 AS input_tokens,
                 COALESCE(SUM("outputTokens"), 0)::float8 AS output_tokens,
                 SUM("estimatedCostUsd")::float8 AS cost
          FROM "AiRequestLog"
          WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
          GROUP BY 1, 2 ORDER BY (COALESCE(SUM("inputTokens"), 0) + COALESCE(SUM("outputTokens"), 0)) DESC LIMIT ${TOP_N}`,
        db.$queryRaw<Array<Agg & { agent_id: string | null; name: string | null }>>`
          SELECT l."agentId" AS agent_id, a."name" AS name, COUNT(*)::int AS n,
                 COALESCE(SUM(l."inputTokens"), 0)::float8 AS input_tokens,
                 COALESCE(SUM(l."outputTokens"), 0)::float8 AS output_tokens,
                 SUM(l."estimatedCostUsd")::float8 AS cost
          FROM "AiRequestLog" l
          LEFT JOIN "Agent" a ON a."id" = l."agentId" AND a."organizationId" = l."organizationId"
          WHERE l."organizationId" = ${org}::uuid AND l."createdAt" >= ${range.from} AND l."createdAt" < ${range.to}
          GROUP BY l."agentId", a."name"
          ORDER BY (COALESCE(SUM(l."inputTokens"), 0) + COALESCE(SUM(l."outputTokens"), 0)) DESC LIMIT ${TOP_N}`,
        db.$queryRaw<Array<Agg & { user_id: string | null; name: string | null }>>`
          SELECT l."userId" AS user_id,
                 NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), '') AS name,
                 COUNT(*)::int AS n,
                 COALESCE(SUM(l."inputTokens"), 0)::float8 AS input_tokens,
                 COALESCE(SUM(l."outputTokens"), 0)::float8 AS output_tokens,
                 SUM(l."estimatedCostUsd")::float8 AS cost
          FROM "AiRequestLog" l
          LEFT JOIN "User" u ON u."id" = l."userId"
          WHERE l."organizationId" = ${org}::uuid AND l."createdAt" >= ${range.from} AND l."createdAt" < ${range.to}
          GROUP BY l."userId", u."firstName", u."lastName"
          ORDER BY (COALESCE(SUM(l."inputTokens"), 0) + COALESCE(SUM(l."outputTokens"), 0)) DESC LIMIT ${TOP_N}`,
        db.$queryRaw<Array<Agg & { bucket: Date }>>`
          SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::int AS n,
                 COALESCE(SUM("inputTokens"), 0)::float8 AS input_tokens,
                 COALESCE(SUM("outputTokens"), 0)::float8 AS output_tokens,
                 SUM("estimatedCostUsd")::float8 AS cost
          FROM "AiRequestLog"
          WHERE "organizationId" = ${org}::uuid AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
          GROUP BY 1`,
        this.entitlements.usageThisPeriod(org, 'ai_tokens'),
        this.entitlements.getLimits(org),
        this.budget.status(org),
      ]);

    const totalsOf = (r: Agg | undefined) => {
      const input = num(r?.input_tokens);
      const output = num(r?.output_tokens);
      return {
        requests: num(r?.n),
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
        costUsd: numOrNull(r?.cost),
      };
    };
    const t = totals[0];
    const month = monthPeriod();
    return {
      generatedAt: new Date().toISOString(),
      range: this.rangeDto(range),
      pricingConfigured: this.pricing.size() > 0,
      totals: {
        ...totalsOf(t),
        successRequests: num(t?.ok),
        errorRequests: num(t?.errors),
        pricedRequests: num(t?.priced),
      },
      byModel: byModel.map((r) => ({ provider: r.provider, model: r.model, ...totalsOf(r) })),
      byAgent: byAgent.map((r) => ({ agentId: r.agent_id, name: r.name, ...totalsOf(r) })),
      byUser: byUser.map((r) => ({ userId: r.user_id, name: r.name, ...totalsOf(r) })),
      series: fillSeries<Agg & { bucket: Date }, { bucket: string } & ReturnType<typeof totalsOf>>(
        range.buckets,
        series,
        (row) => totalsOf(row),
      ),
      currentPeriod: {
        periodStart: month.start.toISOString(),
        periodEnd: month.end.toISOString(),
        planTokenLimit: limits.aiTokensPerMonth,
        tokensUsed,
        percentOfPlan: percentOf(tokensUsed, limits.aiTokensPerMonth),
        budget,
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // CSV export (business, usage)
  // ---------------------------------------------------------------------------------------------

  async exportCsv(
    tenant: TenantContext,
    query: AnalyticsExportQuery,
  ): Promise<{ filename: string; csv: string }> {
    const range = { from: query.from, to: query.to, granularity: query.granularity };
    if (query.report === 'business') {
      const data = await this.business(tenant, range);
      const csv =
        query.section === 'series'
          ? toCsv(
              ['bucket', 'contacts_created', 'leads_created', 'conversations_created'],
              data.contacts.series.map((p, i) => [
                p.bucket,
                p.count,
                data.leads.series[i]?.count ?? 0,
                data.conversations.series[i]?.count ?? 0,
              ]),
            )
          : toCsv(
              ['dimension', 'key', 'count'],
              [
                ...Object.entries(data.leads.byStatus).map(
                  ([k, v]) => ['lead_status', k, v] as const,
                ),
                ...Object.entries(data.leads.bySource).map(
                  ([k, v]) => ['lead_source', k, v] as const,
                ),
                ...data.funnel.stages.map((s) => ['funnel_reached', s.status, s.reached] as const),
                ...Object.entries(data.conversations.byStatus).map(
                  ([k, v]) => ['conversation_status', k, v] as const,
                ),
                ...Object.entries(data.conversations.byChannel).map(
                  ([k, v]) => ['conversation_channel', k, v] as const,
                ),
              ],
            );
      return { filename: exportName('business', query.section, data.range), csv };
    }
    const data = await this.usage(tenant, range);
    const header = ['requests', 'input_tokens', 'output_tokens', 'total_tokens', 'cost_usd'];
    const cells = (r: {
      requests: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number | null;
    }) => [r.requests, r.inputTokens, r.outputTokens, r.totalTokens, r.costUsd];
    const csv =
      query.section === 'series'
        ? toCsv(
            ['bucket', ...header],
            data.series.map((p) => [p.bucket, ...cells(p)]),
          )
        : toCsv(
            ['dimension', 'key', 'name', ...header],
            [
              ...data.byModel.map((r) => [
                'model',
                `${r.provider}:${r.model}`,
                r.model,
                ...cells(r),
              ]),
              ...data.byAgent.map((r) => ['agent', r.agentId, r.name, ...cells(r)]),
              ...data.byUser.map((r) => ['user', r.userId, r.name, ...cells(r)]),
            ],
          );
    return { filename: exportName('usage', query.section, data.range), csv };
  }
}

function exportName(report: string, section: string, range: AnalyticsRange): string {
  return `${report}-${section}-${range.from.slice(0, 10)}_${range.to.slice(0, 10)}.csv`;
}
