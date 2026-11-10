import type {
  BudgetAlert,
  BudgetAlertScope,
  BudgetStatus,
  EntitlementState,
  EntitlementUsage,
  PlanLimits,
  UpdateBudgetRequest,
} from '@hilatech/contracts';
import { ErrorCode } from '@hilatech/contracts';
import { isApiError } from '@/lib/api/client';
import { msg, type Msg } from '@/i18n/msg';
import type { T } from '@/i18n/provider';
import type { Formatter } from '@/i18n/format';

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

export function formatEntitlementValue(
  unit: EntitlementUsage['unit'],
  value: number,
  fmt: Pick<Formatter, 'bytesFromMb' | 'compact'>,
): string {
  if (unit === 'mb') return fmt.bytesFromMb(value);
  return fmt.compact(value);
}

export const ENTITLEMENT_STATE_LABEL: Record<EntitlementState, Msg> = {
  ok: msg('billing.entitlementState.ok'),
  warning: msg('billing.entitlementState.warning'),
  exceeded: msg('billing.entitlementState.exceeded'),
};

/** Message shown next to a meter whose state is not ok (the state is never conveyed by colour alone). */
export function entitlementStateNote(
  e: Pick<EntitlementUsage, 'state' | 'enforced'>,
  t: T,
): string | null {
  if (e.state === 'ok') return null;
  if (e.state === 'warning') return t('billing.approachingTheLimit');
  return e.enforced ? t('billing.limitReachedRefused') : t('billing.overLimitReportedOnly');
}

// ---------------------------------------------------------------------------
// Plan limits and upgrade deltas
// ---------------------------------------------------------------------------

export const PLAN_LIMIT_ROWS: {
  key: keyof PlanLimits;
  label: Msg;
  unit: 'count' | 'mb';
}[] = [
  { key: 'seats', label: msg('billing.limit.seats'), unit: 'count' },
  { key: 'aiTokensPerMonth', label: msg('billing.limit.aiTokensPerMonth'), unit: 'count' },
  { key: 'agents', label: msg('billing.limit.agents'), unit: 'count' },
  {
    key: 'knowledgeDocuments',
    label: msg('billing.limit.knowledgeDocuments'),
    unit: 'count',
  },
  { key: 'storageMb', label: msg('billing.limit.storageMb'), unit: 'mb' },
  { key: 'automations', label: msg('billing.limit.automations'), unit: 'count' },
];

export function formatLimit(
  row: { unit: 'count' | 'mb' },
  value: number,
  fmt: Pick<Formatter, 'bytesFromMb' | 'compact'>,
): string {
  return row.unit === 'mb' ? fmt.bytesFromMb(value) : fmt.compact(value);
}

/** "+400K AI tokens / month" for a limit delta, or null for unknown keys / zero deltas. */
export function describeLimitDelta(
  key: string,
  delta: number,
  t: T,
  fmt: Pick<Formatter, 'bytesFromMb' | 'compact'>,
): string | null {
  const row = PLAN_LIMIT_ROWS.find((r) => r.key === key);
  if (!row || !Number.isFinite(delta) || delta === 0) return null;
  const sign = delta > 0 ? '+' : '−';
  const amount =
    row.unit === 'mb' ? fmt.bytesFromMb(Math.abs(delta)) : fmt.compact(Math.abs(delta));
  return `${sign}${amount} ${t(row.label).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Budget form
// ---------------------------------------------------------------------------

export interface BudgetFormValues {
  monthlyTokenBudget: string;
  monthlyCostBudgetUsd: string;
  warnThresholdPct: string;
  hardStopEnabled: boolean;
}

export type BudgetFormErrors = Partial<Record<keyof BudgetFormValues, string>>;

export const MAX_TOKEN_BUDGET = 1_000_000_000_000;
export const MAX_COST_BUDGET_USD = 100_000_000;

export function budgetToFormValues(status: BudgetStatus): BudgetFormValues {
  const s = status.settings;
  return {
    monthlyTokenBudget: s.monthlyTokenBudget == null ? '' : String(s.monthlyTokenBudget),
    monthlyCostBudgetUsd: s.monthlyCostBudgetUsd == null ? '' : String(s.monthlyCostBudgetUsd),
    warnThresholdPct: String(s.warnThresholdPct),
    hardStopEnabled: s.hardStopEnabled,
  };
}

/**
 * Validates the budget form and builds the PUT body. Empty budget fields clear the budget (`null`).
 * Mirrors the API contract (positive integer tokens, positive USD, warn 1-100, hard stop needs a budget).
 */
export function parseBudgetForm(
  values: BudgetFormValues,
  t: T,
): { ok: true; body: UpdateBudgetRequest } | { ok: false; errors: BudgetFormErrors } {
  const errors: BudgetFormErrors = {};

  const tokenRaw = values.monthlyTokenBudget.trim().replace(/[,_\s]/g, '');
  let tokens: number | null = null;
  if (tokenRaw !== '') {
    if (!/^\d+$/.test(tokenRaw)) errors.monthlyTokenBudget = t('billing.enterAWholeNumberOf');
    else {
      tokens = Number(tokenRaw);
      if (tokens < 1) errors.monthlyTokenBudget = t('billing.mustBeAtLeast1');
      else if (tokens > MAX_TOKEN_BUDGET)
        errors.monthlyTokenBudget = t('billing.thatIsAboveTheMaximum');
    }
  }

  const costRaw = values.monthlyCostBudgetUsd.trim();
  let cost: number | null = null;
  if (costRaw !== '') {
    if (!/^\d+(\.\d+)?$/.test(costRaw))
      errors.monthlyCostBudgetUsd = t('billing.enterAnAmountInUsd');
    else {
      cost = Number(costRaw);
      if (cost <= 0) errors.monthlyCostBudgetUsd = t('billing.mustBeGreaterThan0');
      else if (cost > MAX_COST_BUDGET_USD)
        errors.monthlyCostBudgetUsd = t('billing.thatIsAboveTheMaximum');
    }
  }

  const warnRaw = values.warnThresholdPct.trim();
  let warn = 0;
  if (!/^\d+$/.test(warnRaw)) errors.warnThresholdPct = t('billing.enterAWholePercentageFrom');
  else {
    warn = Number(warnRaw);
    if (warn < 1 || warn > 100) errors.warnThresholdPct = t('billing.enterAPercentageFrom1');
  }

  if (
    values.hardStopEnabled &&
    tokens === null &&
    cost === null &&
    !errors.monthlyTokenBudget &&
    !errors.monthlyCostBudgetUsd
  ) {
    errors.hardStopEnabled = t('billing.setATokenOrCost');
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      monthlyTokenBudget: tokens,
      monthlyCostBudgetUsd: cost,
      warnThresholdPct: warn,
      hardStopEnabled: values.hardStopEnabled,
    },
  };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export const ALERT_SCOPE_LABEL: Record<BudgetAlertScope, Msg> = {
  budget_tokens: msg('billing.alertScope.budget_tokens'),
  budget_cost: msg('billing.alertScope.budget_cost'),
  plan_tokens: msg('billing.alertScope.plan_tokens'),
};

export function formatAlertAmount(
  scope: BudgetAlertScope,
  n: number,
  fmt: Pick<Formatter, 'currency' | 'compact'>,
): string {
  return scope === 'budget_cost' ? fmt.currency(n, 'USD') : fmt.compact(n);
}

export function describeAlert(
  a: Pick<BudgetAlert, 'scope' | 'kind' | 'thresholdPct'>,
  t: T,
): string {
  const what = t(ALERT_SCOPE_LABEL[a.scope]);
  return a.kind === 'exceeded'
    ? t('billing.alertUsedUp', { what })
    : t('billing.alertReachedThreshold', { what, pct: a.thresholdPct });
}

// ---------------------------------------------------------------------------
// 402 BUDGET_EXCEEDED
// ---------------------------------------------------------------------------

export interface BudgetExceededDetails {
  scope?: BudgetAlertScope;
  reason?: 'exhausted' | 'would_exceed';
  used?: number;
  budget?: number | null;
  estimate?: number | null;
}

export function isBudgetExceededCode(code: string | null | undefined): boolean {
  return code === ErrorCode.BUDGET_EXCEEDED;
}

export function isBudgetExceededError(error: unknown): boolean {
  return isApiError(error) && error.status === 402 && error.code === ErrorCode.BUDGET_EXCEEDED;
}

export function readBudgetDetails(details: unknown): BudgetExceededDetails {
  if (!details || typeof details !== 'object') return {};
  const d = details as Record<string, unknown>;
  const scope =
    d.scope === 'budget_tokens' || d.scope === 'budget_cost' || d.scope === 'plan_tokens'
      ? d.scope
      : undefined;
  const reason = d.reason === 'exhausted' || d.reason === 'would_exceed' ? d.reason : undefined;
  return {
    scope,
    reason,
    used: typeof d.used === 'number' ? d.used : undefined,
    budget: typeof d.budget === 'number' ? d.budget : null,
    estimate: typeof d.estimate === 'number' ? d.estimate : null,
  };
}

/** Plain-language summary of why the request was refused. */
export function describeBudgetExceeded(
  details: BudgetExceededDetails,
  t: T,
  fmt: Pick<Formatter, 'currency' | 'compact'>,
): string {
  const what =
    details.scope === 'budget_cost' ? t('billing.aiCostBudget') : t('billing.aiTokenBudget');
  const scope = details.scope ?? 'budget_tokens';
  const figures =
    details.used !== undefined && details.budget != null
      ? t('billing.budgetFigures', {
          used: formatAlertAmount(scope, details.used, fmt),
          budget: formatAlertAmount(scope, details.budget, fmt),
        })
      : '';
  return details.reason === 'would_exceed'
    ? t('billing.requestWouldExceed', { what, figures })
    : t('billing.budgetUsedUp', { what, figures });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** `system` notifications created by the budget service carry `data.kind = "budget_alert"`. */
export function budgetAlertInfo(n: {
  data?: Record<string, unknown> | null;
}): { level: 'warning' | 'exceeded'; label: Msg } | null {
  const data = n.data;
  if (!data || data.kind !== 'budget_alert') return null;
  const level = data.level === 'exceeded' ? 'exceeded' : 'warning';
  return {
    level,
    label: level === 'exceeded' ? msg('billing.budgetUsedUpShort') : msg('billing.budgetWarning'),
  };
}
