import { randomUUID } from 'node:crypto';

import { PricingTable } from '@hilatech/ai-engine';
import {
  AuditAction,
  type BudgetAlert as BudgetAlertDto,
  type BudgetSettings,
  type BudgetStatus,
  ErrorCode,
  type ListBudgetAlertsQuery,
  Permission,
  type UpdateBudgetRequest,
} from '@hilatech/contracts';
import { type BudgetAlert } from '@hilatech/database';
import { monthPeriod } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decimalToNumber } from '../crm/crm.mappers';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisReservationStore } from './budget-reservations';
import {
  type AlertCandidate,
  DEFAULT_WARN_THRESHOLD_PCT,
  admissionCaps,
  budgetLevel,
  dueAlerts,
  percentOf,
  toMicroUsd,
} from './budget.rules';
import { EntitlementsService } from './entitlements.service';

/** What a caller wants to run: a reservation estimate computed from the prompt size and output reserve. */
export interface AdmissionEstimate {
  tokens: number;
  /** Estimated cost, or null when the model has no configured pricing. */
  costUsd: number | null;
}

export interface BudgetReservation {
  /** Always safe to call (idempotent); releases the held headroom. */
  release(): Promise<void>;
}

const NO_RESERVATION: BudgetReservation = { release: async () => undefined };

const DEFAULT_SETTINGS: BudgetSettings = {
  monthlyTokenBudget: null,
  monthlyCostBudgetUsd: null,
  warnThresholdPct: DEFAULT_WARN_THRESHOLD_PCT,
  hardStopEnabled: false,
  updatedAt: null,
  updatedById: null,
};

@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly pricing: PricingTable,
    private readonly reservations: RedisReservationStore,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  get pricingConfigured(): boolean {
    return this.pricing.size() > 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Settings + status
  // ---------------------------------------------------------------------------------------------

  async getSettings(organizationId: string): Promise<BudgetSettings> {
    const row = await this.prisma.client.organizationBudget.findUnique({
      where: { organizationId },
    });
    if (!row) return DEFAULT_SETTINGS;
    return {
      monthlyTokenBudget: row.monthlyTokenBudget === null ? null : Number(row.monthlyTokenBudget),
      monthlyCostBudgetUsd: decimalToNumber(row.monthlyCostBudgetUsd),
      warnThresholdPct: row.warnThresholdPct,
      hardStopEnabled: row.hardStopEnabled,
      updatedAt: row.updatedAt.toISOString(),
      updatedById: row.updatedById,
    };
  }

  async update(
    tenant: TenantContext,
    dto: UpdateBudgetRequest,
    meta: RequestMeta,
  ): Promise<BudgetStatus> {
    const current = await this.getSettings(tenant.organizationId);
    const next = {
      monthlyTokenBudget:
        dto.monthlyTokenBudget === undefined ? current.monthlyTokenBudget : dto.monthlyTokenBudget,
      monthlyCostBudgetUsd:
        dto.monthlyCostBudgetUsd === undefined
          ? current.monthlyCostBudgetUsd
          : dto.monthlyCostBudgetUsd,
      warnThresholdPct: dto.warnThresholdPct ?? current.warnThresholdPct,
      hardStopEnabled: dto.hardStopEnabled ?? current.hardStopEnabled,
    };
    if (next.hardStopEnabled && next.monthlyTokenBudget === null && next.monthlyCostBudgetUsd === null) {
      throw AppException.validation('Hard stop needs a token or cost budget to enforce', [
        {
          path: 'hardStopEnabled',
          message: 'Set monthlyTokenBudget or monthlyCostBudgetUsd first',
          code: 'custom',
        },
      ]);
    }
    const data = {
      monthlyTokenBudget:
        next.monthlyTokenBudget === null ? null : BigInt(next.monthlyTokenBudget),
      monthlyCostBudgetUsd: next.monthlyCostBudgetUsd,
      warnThresholdPct: next.warnThresholdPct,
      hardStopEnabled: next.hardStopEnabled,
      updatedById: tenant.userId,
    };
    await this.prisma.client.organizationBudget.upsert({
      where: { organizationId: tenant.organizationId },
      create: { organizationId: tenant.organizationId, ...data },
      update: data,
    });
    await this.audit.log({
      action: AuditAction.BILLING_BUDGET_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'organization_budget',
      targetId: tenant.organizationId,
      metadata: { ...next },
      request: meta,
    });
    // New thresholds may already be crossed by this month's usage.
    return this.evaluate(tenant.organizationId);
  }

  /** Current-month status of both budgets (read-only). */
  async status(organizationId: string, now = new Date()): Promise<BudgetStatus> {
    const settings = await this.getSettings(organizationId);
    const { start, end } = monthPeriod(now);
    const usage = await this.monthUsage(organizationId, now);

    const tokenLevel = budgetLevel(
      usage.tokensUsed,
      settings.monthlyTokenBudget,
      settings.warnThresholdPct,
    );
    const costBudgeted = settings.monthlyCostBudgetUsd !== null;
    const enforceable = !costBudgeted || this.pricingConfigured;
    const costLevel =
      costBudgeted && enforceable
        ? budgetLevel(
            usage.costUsedUsd ?? 0,
            settings.monthlyCostBudgetUsd,
            settings.warnThresholdPct,
          )
        : 'ok';
    return {
      settings,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      tokens: {
        used: usage.tokensUsed,
        budget: settings.monthlyTokenBudget,
        percent: percentOf(usage.tokensUsed, settings.monthlyTokenBudget),
        level: tokenLevel,
      },
      cost: {
        usedUsd: this.pricingConfigured ? (usage.costUsedUsd ?? 0) : null,
        budgetUsd: settings.monthlyCostBudgetUsd,
        percent: enforceable
          ? percentOf(usage.costUsedUsd ?? 0, settings.monthlyCostBudgetUsd)
          : null,
        level: costLevel,
        enforceable,
        pricedRequests: usage.pricedRequests,
        unpricedRequests: usage.unpricedRequests,
        note: !this.pricingConfigured
          ? 'No model pricing is configured (AI_PRICING_JSON), so AI cost cannot be measured or enforced; the token budget still applies.'
          : usage.unpricedRequests > 0
            ? `${usage.unpricedRequests} request(s) this month used models without configured pricing and are not included in the cost.`
            : null,
      },
      blocked:
        settings.hardStopEnabled &&
        (tokenLevel === 'exceeded' || (costLevel === 'exceeded' && enforceable)),
    };
  }

  /** `status` plus raising the alerts that are due (warning / exceeded), exactly once per month and scope. */
  async evaluate(organizationId: string, now = new Date()): Promise<BudgetStatus> {
    const status = await this.status(organizationId, now);
    await this.raiseAlerts(organizationId, status, now).catch((error: unknown) => {
      this.logger.error({ err: error, organizationId }, 'failed to evaluate budget alerts');
    });
    return status;
  }

  // ---------------------------------------------------------------------------------------------
  // Admission control
  // ---------------------------------------------------------------------------------------------

  /**
   * Call BEFORE any provider is invoked. With hard stop OFF (or no budget) this is free of side
   * effects. With hard stop ON it refuses (402 BUDGET_EXCEEDED) when the budget is exhausted or the
   * estimate does not fit into what is left after the calls that are still running, otherwise it
   * reserves the estimate. Release the reservation in a `finally` once the run is over; the real
   * usage is then already recorded, so the next admission sees the reconciled figures.
   */
  async admit(organizationId: string, estimate: AdmissionEstimate): Promise<BudgetReservation> {
    const settings = await this.getSettings(organizationId);
    if (!settings.hardStopEnabled) return NO_RESERVATION;

    const usage = await this.monthUsage(organizationId);
    const caps = admissionCaps(settings, usage);
    if (caps.tokens === null && caps.costMicroUsd === null) return NO_RESERVATION;

    const reservationId = randomUUID();
    const verdict = await this.reservations.tryReserve(
      organizationId,
      reservationId,
      {
        tokens: estimate.tokens,
        costMicroUsd: estimate.costUsd === null ? null : toMicroUsd(estimate.costUsd),
      },
      caps,
    );
    if (!verdict.allowed) {
      // Make sure the exceeded alert exists even if only reservations (not usage) tipped it.
      this.evaluate(organizationId).catch(() => undefined);
      throw this.refusal(verdict.scope, verdict.reason, settings, usage, estimate);
    }
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await this.reservations.release(organizationId, reservationId);
      },
    };
  }

  private refusal(
    scope: 'tokens' | 'cost',
    reason: 'exhausted' | 'would_exceed',
    settings: BudgetSettings,
    usage: MonthUsage,
    estimate: AdmissionEstimate,
  ): AppException {
    const budget = scope === 'tokens' ? settings.monthlyTokenBudget : settings.monthlyCostBudgetUsd;
    const used = scope === 'tokens' ? usage.tokensUsed : (usage.costUsedUsd ?? 0);
    const message =
      reason === 'exhausted'
        ? `The monthly AI ${scope === 'tokens' ? 'token' : 'cost'} budget is used up (${used}/${budget}). Raise the budget or turn off the hard stop in billing settings.`
        : `This request would exceed the monthly AI ${scope === 'tokens' ? 'token' : 'cost'} budget (${used}/${budget} used, about ${scope === 'tokens' ? estimate.tokens : estimate.costUsd} needed).`;
    return new AppException(HttpStatus.PAYMENT_REQUIRED, ErrorCode.BUDGET_EXCEEDED, message, {
      scope: scope === 'tokens' ? 'budget_tokens' : 'budget_cost',
      reason,
      used,
      budget,
      estimate: scope === 'tokens' ? estimate.tokens : estimate.costUsd,
    });
  }

  /** Cost estimate for a call (null when the model has no configured price). */
  estimateCostUsd(
    provider: Parameters<PricingTable['estimate']>[0],
    model: string,
    tokens: { inputTokens: number; outputTokens: number },
  ): number | null {
    return this.pricing.estimate(provider, model, tokens);
  }

  /**
   * After a run: release is done by the caller; this re-evaluates thresholds on the real usage and
   * raises alerts. Never throws.
   */
  async reconcile(organizationId: string): Promise<void> {
    try {
      await this.evaluate(organizationId);
    } catch (error) {
      this.logger.error({ err: error, organizationId }, 'budget reconcile failed');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------------------------------

  async listAlerts(
    tenant: TenantContext,
    query: ListBudgetAlertsQuery,
  ): Promise<PageResult<BudgetAlertDto>> {
    const where = { organizationId: tenant.organizationId };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.budgetAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.budgetAlert.count({ where }),
    ]);
    return page(rows.map(toBudgetAlert), query, total);
  }

  private async raiseAlerts(organizationId: string, status: BudgetStatus, now: Date): Promise<void> {
    const warn = status.settings.warnThresholdPct;
    const planLimits = await this.entitlements.getLimits(organizationId);
    const candidates: AlertCandidate[] = [
      ...dueAlerts('budget_tokens', status.tokens.used, status.tokens.budget, warn),
      ...(status.cost.enforceable
        ? dueAlerts('budget_cost', status.cost.usedUsd ?? 0, status.cost.budgetUsd, warn)
        : []),
      ...dueAlerts('plan_tokens', status.tokens.used, planLimits.aiTokensPerMonth, warn),
    ];
    if (candidates.length === 0) return;

    const periodStart = monthPeriod(now).start;
    const created = await this.prisma.client.budgetAlert.createManyAndReturn({
      data: candidates.map((c) => ({
        organizationId,
        periodStart,
        scope: c.scope,
        kind: c.kind,
        used: c.used,
        limit: c.limit,
        thresholdPct: c.thresholdPct,
      })),
      skipDuplicates: true,
    });
    if (created.length === 0) return;

    // One notification per scope: `exceeded` supersedes `warning` when both were just created.
    const byScope = new Map<string, BudgetAlert>();
    for (const row of created) {
      const existing = byScope.get(row.scope);
      if (!existing || row.kind === 'exceeded') byScope.set(row.scope, row);
    }
    const recipients = await this.prisma.client.organizationMember.findMany({
      where: {
        organizationId,
        status: 'active',
        role: { permissions: { has: Permission.ORG_BILLING_MANAGE } },
      },
      select: { userId: true },
    });
    for (const row of byScope.values()) {
      const text = alertText(row);
      for (const { userId } of recipients) {
        await this.notifications.notify({
          organizationId,
          userId,
          type: 'system',
          title: text.title,
          body: text.body,
          link: '/settings/billing',
          data: {
            kind: 'budget_alert',
            scope: row.scope,
            level: row.kind,
            used: decimalToNumber(row.used),
            limit: decimalToNumber(row.limit),
            periodStart: row.periodStart.toISOString(),
          },
          idempotencyKey: `budget-${organizationId}-${row.periodStart.toISOString()}-${row.scope}-${row.kind}`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Usage helpers
  // ---------------------------------------------------------------------------------------------

  private async monthUsage(organizationId: string, now = new Date()): Promise<MonthUsage> {
    const { start, end } = monthPeriod(now);
    const [tokensUsed, priced, unpriced] = await Promise.all([
      this.entitlements.usageThisPeriod(organizationId, 'ai_tokens', now),
      this.prisma.client.aiRequestLog.aggregate({
        where: {
          organizationId,
          createdAt: { gte: start, lt: end },
          estimatedCostUsd: { not: null },
        },
        _sum: { estimatedCostUsd: true },
        _count: { _all: true },
      }),
      this.prisma.client.aiRequestLog.count({
        where: {
          organizationId,
          createdAt: { gte: start, lt: end },
          status: 'success',
          estimatedCostUsd: null,
        },
      }),
    ]);
    return {
      tokensUsed,
      costUsedUsd: this.pricingConfigured ? (decimalToNumber(priced._sum.estimatedCostUsd) ?? 0) : null,
      pricedRequests: priced._count._all,
      unpricedRequests: unpriced,
    };
  }
}

interface MonthUsage {
  tokensUsed: number;
  /** null when no model pricing is configured at all. */
  costUsedUsd: number | null;
  pricedRequests: number;
  unpricedRequests: number;
}

export function toBudgetAlert(row: BudgetAlert): BudgetAlertDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    periodStart: row.periodStart.toISOString(),
    scope: row.scope,
    kind: row.kind,
    used: decimalToNumber(row.used) ?? 0,
    limit: decimalToNumber(row.limit) ?? 0,
    thresholdPct: row.thresholdPct,
    createdAt: row.createdAt.toISOString(),
  };
}

export function alertText(row: Pick<BudgetAlert, 'scope' | 'kind' | 'thresholdPct'>): {
  title: string;
  body: string;
} {
  const what =
    row.scope === 'budget_tokens'
      ? 'AI token budget'
      : row.scope === 'budget_cost'
        ? 'AI cost budget'
        : 'plan AI token allowance';
  return row.kind === 'exceeded'
    ? {
        title: `Your monthly ${what} is used up`,
        body: 'Usage reached 100% for this month. Review billing settings or upgrade your plan.',
      }
    : {
        title: `Your monthly ${what} is at ${row.thresholdPct}%`,
        body: `Usage crossed the ${row.thresholdPct}% warning threshold for this month.`,
      };
}
