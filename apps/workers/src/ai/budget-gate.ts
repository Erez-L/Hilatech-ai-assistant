import type { PrismaClient } from '@hilatech/database';
import { monthPeriod } from '@hilatech/shared';

export type BudgetVerdict =
  | { blocked: false }
  | { blocked: true; scope: 'tokens' | 'cost'; used: number; budget: number; message: string };

/**
 * Worker-side AI budget check, run right before a provider is called for work that was queued
 * earlier (async agent runs, workflow agent steps, document embeddings).
 *
 * The API admits requests with a Redis reservation; by the time a queued job runs, the month's
 * budget may have been used up by other calls. This re-check refuses the job when the organization
 * has the hard stop on and the RECORDED usage of the current month already reached a budget. It does
 * not reserve anything, so several jobs that start at the same moment can still overshoot by their
 * own consumption (documented limitation).
 */
export async function checkAiBudget(
  prisma: PrismaClient,
  organizationId: string,
  options: { pricingConfigured: boolean; now?: Date },
): Promise<BudgetVerdict> {
  const settings = await prisma.organizationBudget.findUnique({ where: { organizationId } });
  if (!settings?.hardStopEnabled) return { blocked: false };
  const { start, end } = monthPeriod(options.now ?? new Date());

  if (settings.monthlyTokenBudget !== null) {
    const budget = Number(settings.monthlyTokenBudget);
    const usage = await prisma.usageRecord.aggregate({
      where: { organizationId, metric: 'ai_tokens', periodStart: { gte: start, lt: end } },
      _sum: { quantity: true },
    });
    const used = Number(usage._sum.quantity ?? 0);
    if (used >= budget) {
      return {
        blocked: true,
        scope: 'tokens',
        used,
        budget,
        message: `The monthly AI token budget is used up (${used}/${budget}). Raise the budget or turn off the hard stop in billing settings.`,
      };
    }
  }

  // A cost budget can only be enforced when model pricing is configured (same rule as the API).
  if (settings.monthlyCostBudgetUsd !== null && options.pricingConfigured) {
    const budget = Number(settings.monthlyCostBudgetUsd);
    const cost = await prisma.aiRequestLog.aggregate({
      where: {
        organizationId,
        createdAt: { gte: start, lt: end },
        estimatedCostUsd: { not: null },
      },
      _sum: { estimatedCostUsd: true },
    });
    const used = Number(cost._sum.estimatedCostUsd ?? 0);
    if (used >= budget) {
      return {
        blocked: true,
        scope: 'cost',
        used,
        budget,
        message: `The monthly AI cost budget is used up (${used}/${budget} USD). Raise the budget or turn off the hard stop in billing settings.`,
      };
    }
  }
  return { blocked: false };
}
