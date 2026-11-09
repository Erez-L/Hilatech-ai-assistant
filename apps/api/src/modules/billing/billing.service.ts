import {
  PLAN_LIMITS,
  type PlanKey,
  type PlanLimits,
  type Subscription as SubscriptionDto,
  UsageMetric,
  type UsageSummary,
  planLimitsSchema,
} from '@hilatech/contracts';
import { monthPeriod } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EntitlementsService, USAGE_LIMIT_KEY } from './entitlements.service';

/** TODO(contracts): add `planCatalogEntrySchema` to `@hilatech/contracts`. */
export interface PlanCatalogEntry {
  key: PlanKey;
  limits: PlanLimits;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async getSubscription(tenant: TenantContext): Promise<SubscriptionDto> {
    const sub = await this.prisma.client.subscription.findUnique({
      where: { organizationId: tenant.organizationId },
    });
    if (!sub) throw AppException.notFound('Subscription');
    const limits = planLimitsSchema.safeParse(sub.limits);
    return {
      id: sub.id,
      organizationId: sub.organizationId,
      plan: sub.plan,
      status: sub.status,
      limits: limits.success ? limits.data : PLAN_LIMITS[sub.plan],
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      provider: sub.provider,
      providerSubscriptionId: sub.providerSubscriptionId,
    };
  }

  /** Current calendar month usage per metric against the plan limits. */
  async getUsage(tenant: TenantContext): Promise<UsageSummary> {
    const now = new Date();
    const { start, end } = monthPeriod(now);
    const limits = await this.entitlements.getLimits(tenant.organizationId);
    const metrics = {} as UsageSummary['metrics'];
    for (const metric of UsageMetric.options) {
      const used = await this.entitlements.usageThisPeriod(tenant.organizationId, metric, now);
      const limitKey = USAGE_LIMIT_KEY[metric];
      metrics[metric] = { used, limit: limitKey ? limits[limitKey] : null };
    }
    return { periodStart: start.toISOString(), periodEnd: end.toISOString(), metrics };
  }

  listPlans(): PlanCatalogEntry[] {
    return (Object.keys(PLAN_LIMITS) as PlanKey[]).map((key) => ({
      key,
      limits: PLAN_LIMITS[key],
    }));
  }
}
