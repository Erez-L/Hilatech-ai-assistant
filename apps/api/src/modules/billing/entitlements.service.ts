import {
  type EntitlementUsage,
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
import { entitlementState, percentOf } from './budget.rules';

const MB = 1024 * 1024;

/**
 * Metrics a plan can cap. Every figure comes from the real tables, never from a counter that could drift:
 *  - `seats`: active members + pending invitations;
 *  - `documents` / `storage_mb`: the Document table (stock, same source the knowledge module enforces from);
 *  - `agents` / `automations`: Agent / Workflow rows (stock);
 *  - `ai_tokens`: UsageRecord rows of the current calendar month (written by the AI usage recorder);
 *  - `agent_executions` / `automation_runs`: root AgentExecution / WorkflowExecution rows of the current month.
 */
export type EntitlementMetric = 'seats' | 'agents' | 'automations' | UsageMetric;

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
      return { metric, used: await this.seatsInUse(tenant.organizationId), limit: limits.seats };
    }
    if (metric === 'agents' || metric === 'automations') {
      const used = await this.stock(tenant.organizationId, metric);
      return { metric, used, limit: metric === 'agents' ? limits.agents : limits.automations };
    }
    const limitKey = USAGE_LIMIT_KEY[metric];
    const used = await this.usageThisPeriod(tenant.organizationId, metric);
    return { metric, used, limit: limitKey ? limits[limitKey] : null };
  }

  /** Everything the organization is entitled to, with current consumption, for the usage/limits views. */
  async overview(organizationId: string, now = new Date()): Promise<EntitlementUsage[]> {
    const limits = await this.getLimits(organizationId);
    const seats = await this.seatsInUse(organizationId);
    const [agents, automations] = await Promise.all([
      this.stock(organizationId, 'agents'),
      this.stock(organizationId, 'automations'),
    ]);
    const [tokens, documents, storage, executions, runs] = await Promise.all([
      this.usageThisPeriod(organizationId, 'ai_tokens', now),
      this.usageThisPeriod(organizationId, 'documents', now),
      this.usageThisPeriod(organizationId, 'storage_mb', now),
      this.usageThisPeriod(organizationId, 'agent_executions', now),
      this.usageThisPeriod(organizationId, 'automation_runs', now),
    ]);
    const row = (
      key: EntitlementUsage['key'],
      label: string,
      unit: EntitlementUsage['unit'],
      used: number,
      limit: number | null,
      basis: EntitlementUsage['basis'],
      enforced: boolean,
    ): EntitlementUsage => ({
      key,
      label,
      unit,
      used,
      limit,
      percent: percentOf(used, limit),
      state: entitlementState(used, limit),
      basis,
      enforced,
    });
    return [
      row('seats', 'Team seats', 'count', seats, limits.seats, 'stock', true),
      row('ai_tokens', 'AI tokens this month', 'tokens', tokens, limits.aiTokensPerMonth, 'period', true),
      row('documents', 'Knowledge documents', 'count', documents, limits.knowledgeDocuments, 'stock', true),
      row('storage_mb', 'Document storage', 'mb', storage, limits.storageMb, 'stock', true),
      row('agents', 'Agents', 'count', agents, limits.agents, 'stock', false),
      row('automations', 'Automations', 'count', automations, limits.automations, 'stock', false),
      row('agent_executions', 'Agent executions this month', 'count', executions, null, 'period', false),
      row('automation_runs', 'Automation runs this month', 'count', runs, null, 'period', false),
    ];
  }

  private async seatsInUse(organizationId: string): Promise<number> {
    const [members, pendingInvitations] = await Promise.all([
      this.prisma.client.organizationMember.count({ where: { organizationId, status: 'active' } }),
      this.prisma.client.invitation.count({
        where: { organizationId, status: 'pending', expiresAt: { gt: new Date() } },
      }),
    ]);
    return members + pendingInvitations;
  }

  private async stock(organizationId: string, what: 'agents' | 'automations'): Promise<number> {
    return what === 'agents'
      ? this.prisma.client.agent.count({ where: { organizationId } })
      : this.prisma.client.workflow.count({ where: { organizationId } });
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
    switch (metric) {
      case 'documents':
        return this.prisma.client.document.count({ where: { organizationId } });
      case 'storage_mb': {
        const size = await this.prisma.client.document.aggregate({
          where: { organizationId },
          _sum: { sizeBytes: true },
        });
        return Math.round((Number(size._sum.sizeBytes ?? 0) / MB) * 100) / 100;
      }
      case 'agent_executions':
        return this.prisma.client.agentExecution.count({
          where: { organizationId, parentExecutionId: null, createdAt: { gte: start, lt: end } },
        });
      case 'automation_runs':
        return this.prisma.client.workflowExecution.count({
          where: { organizationId, createdAt: { gte: start, lt: end } },
        });
      case 'ai_tokens':
      default: {
        const result = await this.prisma.client.usageRecord.aggregate({
          where: { organizationId, metric: 'ai_tokens', periodStart: { gte: start, lt: end } },
          _sum: { quantity: true },
        });
        return Number(result._sum.quantity ?? 0);
      }
    }
  }
}
