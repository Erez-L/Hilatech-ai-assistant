import {
  PLAN_LIMITS,
  type PlanLimits,
  type UsageMetric,
  planLimitsSchema,
} from '@hilatech/contracts';
import { monthPeriod } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Metrics a plan can cap. `seats` is derived from members + pending invitations, the rest from UsageRecord. */
export type EntitlementMetric = 'seats' | UsageMetric;

/** Which plan limit applies to a usage metric (null = no cap defined by the plan). */
export const USAGE_LIMIT_KEY: Record<UsageMetric, keyof PlanLimits | null> = {
  ai_tokens: 'aiTokensPerMonth',
  documents: 'knowledgeDocuments',
  storage_mb: 'storageMb',
  agent_executions: null,
  automation_runs: null,
};

export interface LimitCheck {
  metric: EntitlementMetric;
  used: number;
  limit: number | null;
}

/** Pure decision, exported for unit tests. */
export function isWithinLimit(check: LimitCheck): boolean {
  return check.limit === null || check.used < check.limit;
}

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Plan limits snapshot of the organization's subscription (falls back to the free plan when none exists). */
  async getLimits(organizationId: string): Promise<PlanLimits> {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { organizationId },
      select: { limits: true, plan: true },
    });
    if (!subscription) return PLAN_LIMITS.free;
    const parsed = planLimitsSchema.safeParse(subscription.limits);
    return parsed.success ? parsed.data : PLAN_LIMITS[subscription.plan];
  }

  async check(tenant: TenantContext, metric: EntitlementMetric): Promise<LimitCheck> {
    const limits = await this.getLimits(tenant.organizationId);
    if (metric === 'seats') {
      const [members, pendingInvitations] = await Promise.all([
        this.prisma.client.organizationMember.count({
          where: { organizationId: tenant.organizationId, status: 'active' },
        }),
        this.prisma.client.invitation.count({
          where: {
            organizationId: tenant.organizationId,
            status: 'pending',
            expiresAt: { gt: new Date() },
          },
        }),
      ]);
      return { metric, used: members + pendingInvitations, limit: limits.seats };
    }
    const limitKey = USAGE_LIMIT_KEY[metric];
    const used = await this.usageThisPeriod(tenant.organizationId, metric);
    return { metric, used, limit: limitKey ? limits[limitKey] : null };
  }

  /** Throws `402 ENTITLEMENT_EXCEEDED` when adding one more unit of `metric` would exceed the plan. */
  async assertWithinLimit(tenant: TenantContext, metric: EntitlementMetric): Promise<LimitCheck> {
    const check = await this.check(tenant, metric);
    if (!isWithinLimit(check)) {
      throw AppException.entitlementExceeded(
        `Plan limit reached for ${metric} (${check.used}/${check.limit})`,
        check,
      );
    }
    return check;
  }

  async usageThisPeriod(
    organizationId: string,
    metric: UsageMetric,
    now = new Date(),
  ): Promise<number> {
    const { start, end } = monthPeriod(now);
    const result = await this.prisma.client.usageRecord.aggregate({
      where: { organizationId, metric, periodStart: { gte: start, lt: end } },
      _sum: { quantity: true },
    });
    return Number(result._sum.quantity ?? 0);
  }
}
