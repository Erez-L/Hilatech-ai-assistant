import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** TODO(contracts): add `dashboardSummarySchema` to `@hilatech/contracts` when the analytics module lands. */
export const dashboardSummarySchema = z.object({
  generatedAt: z.string().datetime(),
  members: z.object({ active: z.number().int(), suspended: z.number().int() }),
  invitations: z.object({ pending: z.number().int() }),
  contacts: z.object({ total: z.number().int() }),
  leads: z.object({ total: z.number().int(), byStatus: z.record(z.string(), z.number().int()) }),
  conversations: z.object({ total: z.number().int(), open: z.number().int() }),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/**
 * Dashboard counts over data that exists today. CRM modules arrive in the next milestone; until then the
 * counters simply reflect the (possibly empty) tables — never static placeholder numbers.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(tenant: TenantContext): Promise<DashboardSummary> {
    const organizationId = tenant.organizationId;
    const db = this.prisma.client;
    const [
      activeMembers,
      suspendedMembers,
      pendingInvitations,
      contacts,
      leadsByStatus,
      conversations,
      openConversations,
    ] = await Promise.all([
      db.organizationMember.count({ where: { organizationId, status: 'active' } }),
      db.organizationMember.count({ where: { organizationId, status: 'suspended' } }),
      db.invitation.count({
        where: { organizationId, status: 'pending', expiresAt: { gt: new Date() } },
      }),
      db.contact.count({ where: { organizationId, deletedAt: null } }),
      db.lead.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
      }),
      db.conversation.count({ where: { organizationId } }),
      db.conversation.count({ where: { organizationId, status: 'open' } }),
    ]);

    const byStatus: Record<string, number> = {};
    let totalLeads = 0;
    for (const row of leadsByStatus) {
      byStatus[row.status] = row._count._all;
      totalLeads += row._count._all;
    }

    return {
      generatedAt: new Date().toISOString(),
      members: { active: activeMembers, suspended: suspendedMembers },
      invitations: { pending: pendingInvitations },
      contacts: { total: contacts },
      leads: { total: totalLeads, byStatus },
      conversations: { total: conversations, open: openConversations },
    };
  }
}
