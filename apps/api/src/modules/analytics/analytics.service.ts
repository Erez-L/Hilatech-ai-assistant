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
const OPEN_CONVERSATION_STATUSES: ConversationStatus[] = ['open', 'pending'];
const CLOSED_LEAD_STATUSES: LeadStatus[] = ['won', 'lost'];

type SeriesRow = { date: string; count: number };

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
    const inPeriod = { gte: period.from, lte: period.to };
    const db = this.prisma.client;
    const liveLeads = { organizationId, deletedAt: null } as const;
    const liveContacts = { organizationId, deletedAt: null } as const;

    const [
      organization,
      activeMembers,
      suspendedMembers,
      pendingInvitations,
      contactsTotal,
      contactsNew,
      leadsByStatus,
      leadsBySource,
      leadsNew,
      leadsWon,
      leadsLost,
      pipeline,
      wonValue,
      conversationsByStatus,
      conversationsByChannel,
      conversationsUnassigned,
      conversationsNew,
      leadSeries,
      conversationSeries,
      recentLeads,
      recentConversations,
    ] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
      db.organizationMember.count({ where: { organizationId, status: 'active' } }),
      db.organizationMember.count({ where: { organizationId, status: 'suspended' } }),
      db.invitation.count({
        where: { organizationId, status: 'pending', expiresAt: { gt: period.to } },
      }),
      db.contact.count({ where: liveContacts }),
      db.contact.count({ where: { ...liveContacts, createdAt: inPeriod } }),
      db.lead.groupBy({ by: ['status'], where: liveLeads, _count: { _all: true } }),
      db.lead.groupBy({ by: ['source'], where: liveLeads, _count: { _all: true } }),
      db.lead.count({ where: { ...liveLeads, createdAt: inPeriod } }),
      // The schema has no closedAt; a won/lost lead's last update is when it was closed.
      db.lead.count({ where: { ...liveLeads, status: 'won', updatedAt: inPeriod } }),
      db.lead.count({ where: { ...liveLeads, status: 'lost', updatedAt: inPeriod } }),
      db.lead.aggregate({
        where: { ...liveLeads, status: { notIn: CLOSED_LEAD_STATUSES } },
        _sum: { value: true },
      }),
      db.lead.aggregate({
        where: { ...liveLeads, status: 'won', updatedAt: inPeriod },
        _sum: { value: true },
      }),
      db.conversation.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      db.conversation.groupBy({
        by: ['channel'],
        where: { organizationId },
        _count: { _all: true },
      }),
      db.conversation.count({
        where: { organizationId, assigneeId: null, status: { in: OPEN_CONVERSATION_STATUSES } },
      }),
      db.conversation.count({ where: { organizationId, createdAt: inPeriod } }),
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

    const byStatus = countsByKey(
      LeadStatus.options,
      leadsByStatus.map((r) => ({ key: r.status, count: r._count._all })),
    );
    const bySource = countsByKey(
      LeadSource.options,
      leadsBySource.map((r) => ({ key: r.source, count: r._count._all })),
    );
    const conversationStatus = countsByKey(
      ConversationStatus.options,
      conversationsByStatus.map((r) => ({ key: r.status, count: r._count._all })),
    );
    const conversationChannel = countsByKey(
      ConversationChannel.options,
      conversationsByChannel.map((r) => ({ key: r.channel, count: r._count._all })),
    );
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
        pipelineValue: decimalToNumber(pipeline._sum.value) ?? 0,
        wonValueInPeriod: decimalToNumber(wonValue._sum.value) ?? 0,
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
