import {
  ConversationChannel,
  ConversationStatus,
  type DashboardQuery,
  type DashboardSummary,
  LeadSource,
  LeadStatus,
} from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { decimalToNumber, isoOrNull } from '../crm/crm.mappers';
import {
  type ResolvedPeriod,
  countsByKey,
  fillDailySeries,
  reportingCurrency,
  resolvePeriod,
} from './analytics.period';

const RECENT_LIMIT = 5;
const CLOSED_LEAD_STATUSES: LeadStatus[] = ['won', 'lost'];

type SeriesRow = { date: string; count: number };

interface LeadStatRow {
  status: LeadStatus;
  source: LeadSource;
  count: number;
  newInPeriod: number;
  updatedInPeriod: number;
  valueTotal: number;
  valueUpdatedInPeriod: number;
}
interface ConversationStatRow {
  status: ConversationStatus;
  channel: ConversationChannel;
  count: number;
  unassignedOpen: number;
  newInPeriod: number;
}

/** Adds `count` to the row for `key` (rows are keyed by one enum value; callers pass several rows per key). */
function accumulate<K extends string>(
  rows: Array<{ key: K; count: number }>,
  key: K,
  count: number,
): void {
  const existing = rows.find((r) => r.key === key);
  if (existing) existing.count += count;
  else rows.push({ key, count });
}

/** Money columns are numeric(14,2): summing per-group floats and rounding to cents is exact at this scale. */
const roundMoney = (n: number): number => Math.round(n * 100) / 100;

/**
 * Dashboard summary: every number is computed live from the organization's rows (never cached
 * placeholders). Daily series run as one parameterised, organization-scoped SQL query each.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(tenant: TenantContext, query: DashboardQuery): Promise<DashboardSummary> {
    const organizationId = tenant.organizationId;
    const period = resolvePeriod(query.period);
    const db = this.prisma.client;
    const liveLeads = { organizationId, deletedAt: null } as const;

    // Three consolidated scans (leads / conversations / contacts) replace what used to be 15 separate
    // count/groupBy/aggregate statements, so a dashboard view costs ~10 queries instead of 21 and each
    // large table is read once. Results are identical (see tests/load/dashboard-diff.mjs).
    const [
      organization,
      memberStatusRows,
      pendingInvitations,
      contactStats,
      leadRows,
      conversationRows,
      leadSeries,
      conversationSeries,
      recentLeads,
      recentConversations,
    ] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
      db.organizationMember.groupBy({
        by: ['status'],
        where: { organizationId, status: { in: ['active', 'suspended'] } },
        _count: { _all: true },
      }),
      db.invitation.count({
        where: { organizationId, status: 'pending', expiresAt: { gt: period.to } },
      }),
      this.contactStats(organizationId, period),
      this.leadStats(organizationId, period),
      this.conversationStats(organizationId, period),
      this.dailySeries('Lead', organizationId, period, true),
      this.dailySeries('Conversation', organizationId, period, false),
      db.lead.findMany({
        where: liveLeads,
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          title: true,
          status: true,
          value: true,
          currency: true,
          createdAt: true,
        },
      }),
      db.conversation.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: { id: true, subject: true, status: true, channel: true, lastMessageAt: true },
      }),
    ]);

    const activeMembers = memberStatusRows.find((r) => r.status === 'active')?._count._all ?? 0;
    const suspendedMembers =
      memberStatusRows.find((r) => r.status === 'suspended')?._count._all ?? 0;
    const contactsTotal = contactStats.total;
    const contactsNew = contactStats.newInPeriod;

    const leadsByStatus: Array<{ key: LeadStatus; count: number }> = [];
    const leadsBySource: Array<{ key: LeadSource; count: number }> = [];
    let leadsNew = 0;
    let leadsWon = 0;
    let leadsLost = 0;
    let pipelineValue = 0;
    let wonValue = 0;
    for (const row of leadRows) {
      accumulate(leadsByStatus, row.status, row.count);
      accumulate(leadsBySource, row.source, row.count);
      leadsNew += row.newInPeriod;
      // The schema has no closedAt; a won/lost lead's last update is when it was closed.
      if (row.status === 'won') {
        leadsWon += row.updatedInPeriod;
        wonValue += row.valueUpdatedInPeriod;
      }
      if (row.status === 'lost') leadsLost += row.updatedInPeriod;
      if (!CLOSED_LEAD_STATUSES.includes(row.status)) pipelineValue += row.valueTotal;
    }

    const conversationsByStatus: Array<{ key: ConversationStatus; count: number }> = [];
    const conversationsByChannel: Array<{ key: ConversationChannel; count: number }> = [];
    let conversationsUnassigned = 0;
    let conversationsNew = 0;
    for (const row of conversationRows) {
      accumulate(conversationsByStatus, row.status, row.count);
      accumulate(conversationsByChannel, row.channel, row.count);
      conversationsUnassigned += row.unassignedOpen;
      conversationsNew += row.newInPeriod;
    }

    const byStatus = countsByKey(LeadStatus.options, leadsByStatus);
    const bySource = countsByKey(LeadSource.options, leadsBySource);
    const conversationStatus = countsByKey(ConversationStatus.options, conversationsByStatus);
    const conversationChannel = countsByKey(ConversationChannel.options, conversationsByChannel);
    const leadsTotal = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    const conversationsTotal = Object.values(conversationStatus).reduce((sum, n) => sum + n, 0);

    return {
      generatedAt: period.to.toISOString(),
      period: { key: period.key, from: period.from.toISOString(), to: period.to.toISOString() },
      members: { active: activeMembers, suspended: suspendedMembers },
      invitations: { pending: pendingInvitations },
      contacts: { total: contactsTotal, newInPeriod: contactsNew },
      leads: {
        total: leadsTotal,
        open: leadsTotal - byStatus.won - byStatus.lost,
        newInPeriod: leadsNew,
        wonInPeriod: leadsWon,
        lostInPeriod: leadsLost,
        byStatus,
        bySource,
        pipelineValue: roundMoney(pipelineValue),
        wonValueInPeriod: roundMoney(wonValue),
        currency: reportingCurrency(organization?.settings),
      },
      conversations: {
        total: conversationsTotal,
        open: conversationStatus.open,
        pending: conversationStatus.pending,
        unassigned: conversationsUnassigned,
        newInPeriod: conversationsNew,
        byStatus: conversationStatus,
        byChannel: conversationChannel,
      },
      series: {
        leadsCreated: fillDailySeries(period, leadSeries),
        conversationsCreated: fillDailySeries(period, conversationSeries),
      },
      recentLeads: recentLeads.map((l) => ({
        id: l.id,
        title: l.title,
        status: l.status,
        value: decimalToNumber(l.value),
        currency: l.currency,
        createdAt: l.createdAt.toISOString(),
      })),
      recentConversations: recentConversations.map((c) => ({
        id: c.id,
        subject: c.subject,
        status: c.status,
        channel: c.channel,
        lastMessageAt: isoOrNull(c.lastMessageAt),
      })),
    };
  }

  /** One scan of the organization's live leads: counts and sums per (status, source), period filters via FILTER. */
  private async leadStats(organizationId: string, period: ResolvedPeriod): Promise<LeadStatRow[]> {
    const rows = await this.prisma.client.$queryRaw<
      Array<
        Omit<LeadStatRow, 'valueTotal' | 'valueUpdatedInPeriod'> & {
          valueTotal: string;
          valueUpdatedInPeriod: string;
        }
      >
    >`
      SELECT "status"::text AS status, "source"::text AS source,
             COUNT(*)::int AS count,
             (COUNT(*) FILTER (WHERE "createdAt" >= ${period.from} AND "createdAt" <= ${period.to}))::int AS "newInPeriod",
             (COUNT(*) FILTER (WHERE "updatedAt" >= ${period.from} AND "updatedAt" <= ${period.to}))::int AS "updatedInPeriod",
             COALESCE(SUM("value"), 0)::text AS "valueTotal",
             COALESCE(SUM("value") FILTER (WHERE "updatedAt" >= ${period.from} AND "updatedAt" <= ${period.to}), 0)::text AS "valueUpdatedInPeriod"
      FROM "Lead"
      WHERE "organizationId" = ${organizationId}::uuid AND "deletedAt" IS NULL
      GROUP BY "status", "source"`;
    return rows.map((r) => ({
      ...r,
      valueTotal: Number(r.valueTotal),
      valueUpdatedInPeriod: Number(r.valueUpdatedInPeriod),
    }));
  }

  private async conversationStats(
    organizationId: string,
    period: ResolvedPeriod,
  ): Promise<ConversationStatRow[]> {
    return this.prisma.client.$queryRaw<ConversationStatRow[]>`
      SELECT "status"::text AS status, "channel"::text AS channel,
             COUNT(*)::int AS count,
             (COUNT(*) FILTER (WHERE "assigneeId" IS NULL AND "status" IN ('open', 'pending')))::int AS "unassignedOpen",
             (COUNT(*) FILTER (WHERE "createdAt" >= ${period.from} AND "createdAt" <= ${period.to}))::int AS "newInPeriod"
      FROM "Conversation"
      WHERE "organizationId" = ${organizationId}::uuid
      GROUP BY "status", "channel"`;
  }

  private async contactStats(
    organizationId: string,
    period: ResolvedPeriod,
  ): Promise<{ total: number; newInPeriod: number }> {
    const rows = await this.prisma.client.$queryRaw<Array<{ total: number; newInPeriod: number }>>`
      SELECT COUNT(*)::int AS total,
             (COUNT(*) FILTER (WHERE "createdAt" >= ${period.from} AND "createdAt" <= ${period.to}))::int AS "newInPeriod"
      FROM "Contact"
      WHERE "organizationId" = ${organizationId}::uuid AND "deletedAt" IS NULL`;
    return rows[0] ?? { total: 0, newInPeriod: 0 };
  }

  /**
   * Rows created per UTC day inside the period for one table. The table name is a compile-time
   * constant (never user input); organization id and bounds are bound parameters.
   */
  private dailySeries(
    table: 'Lead' | 'Conversation',
    organizationId: string,
    period: ResolvedPeriod,
    softDeleted: boolean,
  ): Promise<SeriesRow[]> {
    const tableRef = table === 'Lead' ? Prisma.sql`"Lead"` : Prisma.sql`"Conversation"`;
    const notDeleted = softDeleted ? Prisma.sql`AND "deletedAt" IS NULL` : Prisma.empty;
    return this.prisma.client.$queryRaw<SeriesRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM ${tableRef}
      WHERE "organizationId" = ${organizationId}::uuid
        AND "createdAt" >= ${period.from} AND "createdAt" <= ${period.to}
        ${notDeleted}
      GROUP BY 1
      ORDER BY 1`;
  }
}
