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
import { formatBytesFromMb, formatCompact, formatCurrency } from '@hilatech/ui';
import { isApiError } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

export function formatEntitlementValue(unit: EntitlementUsage['unit'], value: number): string {
  if (unit === 'mb') return formatBytesFromMb(value);
  return formatCompact(value);
}

export const ENTITLEMENT_STATE_LABEL: Record<EntitlementState, string> = {
  ok: 'OK',
  warning: 'Warning',
  exceeded: 'Limit reached',
};

/** Message shown next to a meter whose state is not ok (the state is never conveyed by colour alone). */
export function entitlementStateNote(
  e: Pick<EntitlementUsage, 'state' | 'enforced'>,
): string | null {
  if (e.state === 'ok') return null;
  if (e.state === 'warning') return 'Approaching the limit';
  return e.enforced ? 'Limit reached: new items are refused' : 'Over the limit (reported only)';
}

// ---------------------------------------------------------------------------
// Plan limits and upgrade deltas
// ---------------------------------------------------------------------------

export const PLAN_LIMIT_ROWS: {
  key: keyof PlanLimits;
  label: string;
  format: (n: number) => string;
}[] = [
  { key: 'seats', label: 'Seats', format: formatCompact },
  { key: 'aiTokensPerMonth', label: 'AI tokens / month', format: formatCompact },
  { key: 'agents', label: 'Agents', format: formatCompact },
  { key: 'knowledgeDocuments', label: 'Knowledge documents', format: formatCompact },
  { key: 'storageMb', label: 'Storage', format: formatBytesFromMb },
  { key: 'automations', label: 'Automations', format: formatCompact },
];

/** "+400K AI tokens / month" for a limit delta, or null for unknown keys / zero deltas. */
export function describeLimitDelta(key: string, delta: number): string | null {
  const row = PLAN_LIMIT_ROWS.find((r) => r.key === key);
  if (!row || !Number.isFinite(delta) || delta === 0) return null;
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${row.format(Math.abs(delta))} ${row.label.toLowerCase()}`;
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
): { ok: true; body: UpdateBudgetRequest } | { ok: false; errors: BudgetFormErrors } {
  const errors: BudgetFormErrors = {};

  const tokenRaw = values.monthlyTokenBudget.trim().replace(/[,_\s]/g, '');
  let tokens: number | null = null;
  if (tokenRaw !== '') {
    if (!/^\d+$/.test(tokenRaw)) errors.monthlyTokenBudget = 'Enter a whole number of tokens';
    else {
      tokens = Number(tokenRaw);
      if (tokens < 1) errors.monthlyTokenBudget = 'Must be at least 1 token';
      else if (tokens > MAX_TOKEN_BUDGET) errors.monthlyTokenBudget = 'That is above the maximum';
    }
  }

  const costRaw = values.monthlyCostBudgetUsd.trim();
  let cost: number | null = null;
  if (costRaw !== '') {
    if (!/^\d+(\.\d+)?$/.test(costRaw)) errors.monthlyCostBudgetUsd = 'Enter an amount in USD';
    else {
      cost = Number(costRaw);
      if (cost <= 0) errors.monthlyCostBudgetUsd = 'Must be greater than 0';
      else if (cost > MAX_COST_BUDGET_USD)
        errors.monthlyCostBudgetUsd = 'That is above the maximum';
    }
  }

  const warnRaw = values.warnThresholdPct.trim();
  let warn = 0;
  if (!/^\d+$/.test(warnRaw)) errors.warnThresholdPct = 'Enter a whole percentage from 1 to 100';
  else {
    warn = Number(warnRaw);
    if (warn < 1 || warn > 100) errors.warnThresholdPct = 'Enter a percentage from 1 to 100';
  }

  if (
    values.hardStopEnabled &&
    tokens === null &&
    cost === null &&
    !errors.monthlyTokenBudget &&
    !errors.monthlyCostBudgetUsd
  ) {
    errors.hardStopEnabled = 'Set a token or cost budget before turning on the hard stop';
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

export const ALERT_SCOPE_LABEL: Record<BudgetAlertScope, string> = {
  budget_tokens: 'AI token budget',
  budget_cost: 'AI cost budget',
  plan_tokens: 'Plan AI token allowance',
};

export function formatAlertAmount(scope: BudgetAlertScope, n: number): string {
  return scope === 'budget_cost' ? formatCurrency(n, 'USD') : formatCompact(n);
}

export function describeAlert(a: Pick<BudgetAlert, 'scope' | 'kind' | 'thresholdPct'>): string {
  const what = ALERT_SCOPE_LABEL[a.scope];
  return a.kind === 'exceeded'
    ? `${what} used up`
    : `${what} reached the ${a.thresholdPct}% warning threshold`;
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
export function describeBudgetExceeded(details: BudgetExceededDetails): string {
  const what = details.scope === 'budget_cost' ? 'AI cost budget' : 'AI token budget';
  const scope = details.scope ?? 'budget_tokens';
  const figures =
    details.used !== undefined && details.budget != null
      ? ` (${formatAlertAmount(scope, details.used)} of ${formatAlertAmount(scope, details.budget)} used)`
      : '';
  return details.reason === 'would_exceed'
    ? `This request would go over your organization’s monthly ${what}${figures}.`
    : `Your organization’s monthly ${what} is used up${figures}.`;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** `system` notifications created by the budget service carry `data.kind = "budget_alert"`. */
export function budgetAlertInfo(n: {
  data?: Record<string, unknown> | null;
}): { level: 'warning' | 'exceeded'; label: string } | null {
  const data = n.data;
  if (!data || data.kind !== 'budget_alert') return null;
  const level = data.level === 'exceeded' ? 'exceeded' : 'warning';
  return { level, label: level === 'exceeded' ? 'Budget used up' : 'Budget warning' };
}
