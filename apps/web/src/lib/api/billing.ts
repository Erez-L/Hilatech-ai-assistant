import type {
  BudgetAlert,
  BudgetStatus,
  CheckoutRequest,
  EntitlementsOverview,
  PlanCatalogEntry,
  PlanKey,
  PlanLimits,
  Subscription,
  UpdateBudgetRequest,
  UpgradeOptions,
  UsageSummary,
} from '@hilatech/contracts';
import { api } from './client';

type RawPlans = Record<string, PlanLimits> | { key: PlanKey; limits: PlanLimits }[];

/** The API returns `[{ key, limits }]`; a record keyed by plan is accepted too. */
export function normalizePlans(raw: RawPlans): Partial<Record<PlanKey, PlanLimits>> {
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((p) => [p.key, p.limits])) as Partial<
      Record<PlanKey, PlanLimits>
    >;
  }
  return raw as Partial<Record<PlanKey, PlanLimits>>;
}

export const billingApi = {
  subscription: () => api.get<Subscription>('/billing/subscription'),
  usage: () => api.get<UsageSummary>('/billing/usage'),
  plans: async () =>
    normalizePlans(await api.get<RawPlans>('/billing/plans', { organization: false })),
  entitlements: () => api.get<EntitlementsOverview>('/billing/entitlements'),
  upgradeOptions: () => api.get<UpgradeOptions>('/billing/upgrade-options'),
  /** Always answers 501 PAYMENT_NOT_CONFIGURED today (no payment provider exists). */
  checkout: (plan: CheckoutRequest['plan']) =>
    api.post<unknown>('/billing/checkout', { plan } satisfies CheckoutRequest),
  budget: () => api.get<BudgetStatus>('/billing/budget'),
  updateBudget: (body: UpdateBudgetRequest) => api.put<BudgetStatus>('/billing/budget', body),
  alerts: (params: { page?: number; pageSize?: number } = {}) =>
    api.list<BudgetAlert>('/billing/alerts', { page: params.page, pageSize: params.pageSize }),
};

export type { PlanCatalogEntry };
