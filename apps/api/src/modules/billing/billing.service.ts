import {
  ErrorCode,
  type EntitlementsOverview,
  PLAN_LIMITS,
  type PlanCatalogEntry,
  type Subscription as SubscriptionDto,
  UsageMetric,
  type UpgradeOptions,
  type UsageSummary,
  planLimitsSchema,
} from '@hilatech/contracts';
import { monthPeriod } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EntitlementsService, USAGE_LIMIT_KEY } from './entitlements.service';
import { PRICING_NOTE, buildUpgradeOptions, planCatalog } from './plan-catalog';

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
    return planCatalog();
  }

  /** Every entitlement with its real consumption (stock tables / current-month records) and state. */
  async getEntitlements(tenant: TenantContext): Promise<EntitlementsOverview> {
    const [sub, entitlements] = await Promise.all([
      this.getSubscription(tenant),
      this.entitlements.overview(tenant.organizationId),
    ]);
    return {
      plan: sub.plan,
      status: sub.status,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      entitlements,
    };
  }

  /** Upgrade-flow data only. There is no payment provider: the response says so explicitly. */
  async getUpgradeOptions(tenant: TenantContext): Promise<UpgradeOptions> {
    const overview = await this.getEntitlements(tenant);
    const sub = await this.getSubscription(tenant);
    const pressure = overview.entitlements
      .filter((e) => e.state !== 'ok')
      .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
    return {
      currentPlan: sub.plan,
      subscriptionStatus: sub.status,
      pressure,
      options: buildUpgradeOptions(sub.plan, sub.limits, pressure),
      payment: { configured: false, provider: null, message: PRICING_NOTE },
    };
  }

  /** No payment provider exists, so no plan change can be paid for: answer honestly. */
  checkoutNotConfigured(): never {
    throw new AppException(
      HttpStatus.NOT_IMPLEMENTED,
      ErrorCode.PAYMENT_NOT_CONFIGURED,
      'Online checkout is not available: no payment provider is configured. Contact your account team to change plan.',
    );
  }
}
