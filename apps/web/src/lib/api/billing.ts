import type { PlanKey, PlanLimits, Subscription, UsageSummary } from '@hilatech/contracts';
import { api } from './client';

type RawPlans = Record<string, PlanLimits> | { key: PlanKey; limits: PlanLimits }[];

/** The API returns `[{ key, limits }]`; a record keyed by plan is accepted too. */
export function normalizePlans(raw: RawPlans): Partial<Record<PlanKey, PlanLimits>> {
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((p) => [p.key, p.limits])) as Partial<Record<PlanKey, PlanLimits>>;
  }
  return raw as Partial<Record<PlanKey, PlanLimits>>;
}

export const billingApi = {
  subscription: () => api.get<Subscription>('/billing/subscription'),
  usage: () => api.get<UsageSummary>('/billing/usage'),
  plans: async () => normalizePlans(await api.get<RawPlans>('/billing/plans', { organization: false })),
};
