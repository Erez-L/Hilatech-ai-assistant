import {
  type BudgetAlertKind,
  type BudgetAlertScope,
  type BudgetLevel,
  ENTITLEMENT_WARNING_PCT,
  type EntitlementState,
} from '@hilatech/contracts';

/** Pure budget / entitlement arithmetic (unit-tested; no I/O). */

export const DEFAULT_WARN_THRESHOLD_PCT = 80;
/** Fixed allowance for the system prompt, tool schemas and framing that are not part of the user's text. */
export const PROMPT_OVERHEAD_TOKENS = 1_500;
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 4_096;
const CHARS_PER_TOKEN = 4;

export const MICRO_USD = 1_000_000;
export const toMicroUsd = (usd: number): number => Math.round(usd * MICRO_USD);

export function percentOf(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null;
  return Math.round((used / limit) * 10_000) / 100;
}

/** ok < warnPct <= warning < 100 <= exceeded. No limit = ok. */
export function budgetLevel(
  used: number,
  limit: number | null,
  warnPct: number = DEFAULT_WARN_THRESHOLD_PCT,
): BudgetLevel {
  if (limit === null || limit <= 0) return 'ok';
  if (used >= limit) return 'exceeded';
  return (used / limit) * 100 >= warnPct ? 'warning' : 'ok';
}

/** Plan entitlement state; an entitlement with limit 0 is exceeded as soon as anything is used. */
export function entitlementState(used: number, limit: number | null): EntitlementState {
  if (limit === null) return 'ok';
  if (limit <= 0) return used > 0 ? 'exceeded' : 'ok';
  if (used >= limit) return 'exceeded';
  return (used / limit) * 100 >= ENTITLEMENT_WARNING_PCT ? 'warning' : 'ok';
}

/**
 * Conservative pre-flight estimate of the tokens one model call can consume: the prompt text
 * (~4 chars/token) plus a fixed overhead plus the output reserve the run is allowed to produce.
 * It is reconciled with the real usage (written by the usage recorder) once the call finished.
 */
export function estimateRequest(params: {
  textChars: number;
  outputReserveTokens?: number | null;
  /** Never reserve more than the run itself is allowed to consume. */
  maxTokens?: number | null;
}): { inputTokens: number; outputTokens: number; total: number } {
  let inputTokens =
    Math.ceil(Math.max(0, params.textChars) / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS;
  let outputTokens = params.outputReserveTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS;
  if (params.maxTokens && params.maxTokens > 0 && inputTokens + outputTokens > params.maxTokens) {
    // Shrink proportionally so input/output stay consistent with the capped total.
    const ratio = params.maxTokens / (inputTokens + outputTokens);
    inputTokens = Math.floor(inputTokens * ratio);
    outputTokens = params.maxTokens - inputTokens;
  }
  return { inputTokens, outputTokens, total: inputTokens + outputTokens };
}

export interface BudgetSettingsLike {
  monthlyTokenBudget: number | null;
  monthlyCostBudgetUsd: number | null;
  warnThresholdPct: number;
  hardStopEnabled: boolean;
}

export interface BudgetUsageLike {
  tokensUsed: number;
  /** null = cost cannot be measured (no model pricing configured at all). */
  costUsedUsd: number | null;
}

/** How much headroom is left; `null` = that dimension is not enforced. */
export interface AdmissionCaps {
  tokens: number | null;
  costMicroUsd: number | null;
}

/** Headroom per dimension for hard-stop admission. Only meaningful when `hardStopEnabled`. */
export function admissionCaps(settings: BudgetSettingsLike, usage: BudgetUsageLike): AdmissionCaps {
  const tokens =
    settings.monthlyTokenBudget === null
      ? null
      : Math.max(0, settings.monthlyTokenBudget - usage.tokensUsed);
  const costMicroUsd =
    settings.monthlyCostBudgetUsd === null || usage.costUsedUsd === null
      ? null
      : Math.max(0, toMicroUsd(settings.monthlyCostBudgetUsd) - toMicroUsd(usage.costUsedUsd));
  return { tokens, costMicroUsd };
}

export interface AdmissionRequest {
  tokens: number;
  /** null = the model has no pricing: only an already-exhausted cost budget can refuse the call. */
  costMicroUsd: number | null;
}

export interface Reserved {
  tokens: number;
  costMicroUsd: number;
}

export type AdmissionVerdict =
  | { allowed: true }
  | { allowed: false; scope: 'tokens' | 'cost'; reason: 'exhausted' | 'would_exceed' };

/** The decision the Redis Lua script mirrors: a cap of 0 refuses everything, otherwise reserved + estimate must fit. */
export function decideAdmission(
  caps: AdmissionCaps,
  reserved: Reserved,
  request: AdmissionRequest,
): AdmissionVerdict {
  if (caps.tokens !== null) {
    if (caps.tokens <= 0) return { allowed: false, scope: 'tokens', reason: 'exhausted' };
    if (reserved.tokens + request.tokens > caps.tokens) {
      return { allowed: false, scope: 'tokens', reason: 'would_exceed' };
    }
  }
  if (caps.costMicroUsd !== null) {
    if (caps.costMicroUsd <= 0) return { allowed: false, scope: 'cost', reason: 'exhausted' };
    if (
      request.costMicroUsd !== null &&
      reserved.costMicroUsd + request.costMicroUsd > caps.costMicroUsd
    ) {
      return { allowed: false, scope: 'cost', reason: 'would_exceed' };
    }
  }
  return { allowed: true };
}

export interface AlertCandidate {
  scope: BudgetAlertScope;
  kind: BudgetAlertKind;
  used: number;
  limit: number;
  thresholdPct: number;
}

/**
 * Alerts that are DUE for the current usage: `warning` once usage reaches the warn threshold and
 * `exceeded` at 100%. Reaching 100% makes both due (so the history is complete when usage jumps).
 * Persistence de-duplicates per (organization, month, scope, kind).
 */
export function dueAlerts(
  scope: BudgetAlertScope,
  used: number,
  limit: number | null,
  warnPct: number,
): AlertCandidate[] {
  if (limit === null || limit <= 0) return [];
  const out: AlertCandidate[] = [];
  const pct = (used / limit) * 100;
  if (pct >= warnPct) out.push({ scope, kind: 'warning', used, limit, thresholdPct: warnPct });
  if (used >= limit) out.push({ scope, kind: 'exceeded', used, limit, thresholdPct: 100 });
  return out;
}
