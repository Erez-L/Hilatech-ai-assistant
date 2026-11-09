import {
  type EntitlementKey,
  type EntitlementUsage,
  PLAN_LIMITS,
  type PlanCatalogEntry,
  type PlanKey,
  type PlanLimits,
  type UpgradeOption,
} from '@hilatech/contracts';

import { entitlementState } from './budget.rules';

export const PLAN_ORDER: readonly PlanKey[] = ['free', 'starter', 'pro', 'enterprise'];
const PLAN_NAMES: Record<PlanKey, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

/** Which plan limit caps which entitlement (entitlements without a plan limit are absent). */
export const ENTITLEMENT_LIMIT_KEY: Partial<Record<EntitlementKey, keyof PlanLimits>> = {
  seats: 'seats',
  ai_tokens: 'aiTokensPerMonth',
  documents: 'knowledgeDocuments',
  storage_mb: 'storageMb',
  agents: 'agents',
  automations: 'automations',
};

export const PRICING_NOTE =
  'No prices are configured. Plan changes are handled by the account team until a payment provider is connected.';

export function planCatalog(): PlanCatalogEntry[] {
  return PLAN_ORDER.map((key, rank) => ({
    key,
    name: PLAN_NAMES[key],
    rank,
    limits: PLAN_LIMITS[key],
    pricing: { configured: false as const, note: PRICING_NOTE },
  }));
}

/**
 * Plans above the current one, with limit deltas and which entitlements under pressure
 * (warning/exceeded) they would bring back to `ok`. Data only: no checkout happens here.
 */
export function buildUpgradeOptions(
  currentPlan: PlanKey,
  currentLimits: PlanLimits,
  pressure: readonly EntitlementUsage[],
): UpgradeOption[] {
  const currentRank = PLAN_ORDER.indexOf(currentPlan);
  return planCatalog()
    .filter((entry) => entry.rank > currentRank)
    .map((plan) => {
      const limitDeltas: Record<string, number> = {};
      for (const key of Object.keys(plan.limits) as Array<keyof PlanLimits>) {
        limitDeltas[key] = plan.limits[key] - currentLimits[key];
      }
      const resolves = pressure
        .filter((e) => {
          const limitKey = ENTITLEMENT_LIMIT_KEY[e.key];
          return limitKey ? entitlementState(e.used, plan.limits[limitKey]) === 'ok' : false;
        })
        .map((e) => e.key);
      return { plan, limitDeltas, resolves };
    });
}
