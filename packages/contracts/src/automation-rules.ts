import { ALL_DOMAIN_EVENTS, type WorkflowStep, type WorkflowTrigger } from './automation';

/**
 * Pure (framework-free, side-effect-free) automation logic shared by the API (validation), the workers
 * (execution) and the web app (live validation): cron evaluation, `{{ path }}` templating, condition
 * evaluation and workflow definition validation.
 */

// ---------------------------------------------------------------------------
// Cron (5 fields: minute hour day-of-month month day-of-week), evaluated in an IANA time zone
// ---------------------------------------------------------------------------

export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronParseError';
  }
}

export interface ParsedCron {
  minute: ReadonlySet<number>;
  hour: ReadonlySet<number>;
  dayOfMonth: ReadonlySet<number>;
  month: ReadonlySet<number>;
  /** 0-6, Sunday = 0 (7 is accepted as Sunday). */
  dayOfWeek: ReadonlySet<number>;
  /** Whether the day-of-month / day-of-week field was `*` (POSIX: if both are restricted, either may match). */
  dayOfMonthAny: boolean;
  dayOfWeekAny: boolean;
}

const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseCronValue(
  raw: string,
  min: number,
  max: number,
  names: string[] | null,
  label: string,
): number {
  const lower = raw.toLowerCase();
  if (names) {
    const idx = names.indexOf(lower);
    if (idx >= 0) return label === 'month' ? idx + 1 : idx;
  }
  if (!/^\d+$/.test(raw)) throw new CronParseError(`Invalid ${label} value "${raw}"`);
  const value = Number(raw);
  if (value < min || value > max) {
    throw new CronParseError(`${label} value ${value} is out of range ${min}-${max}`);
  }
  return value;
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  label: string,
  names: string[] | null = null,
): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '') throw new CronParseError(`Empty ${label} list item`);
    const [rangePart, stepPart, ...rest] = part.split('/');
    if (rest.length > 0) throw new CronParseError(`Invalid ${label} expression "${part}"`);
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) {
        throw new CronParseError(`Invalid ${label} step "${stepPart}"`);
      }
      step = Number(stepPart);
    }
    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart!.includes('-')) {
      const [a, b, ...more] = rangePart!.split('-');
      if (more.length > 0 || !a || !b)
        throw new CronParseError(`Invalid ${label} range "${rangePart}"`);
      start = parseCronValue(a, min, max, names, label);
      end = parseCronValue(b, min, max, names, label);
      if (start > end) throw new CronParseError(`Invalid ${label} range "${rangePart}"`);
    } else {
      start = parseCronValue(rangePart!, min, max, names, label);
      end = stepPart !== undefined ? max : start;
    }
    for (let v = start; v <= end; v += step) out.add(v);
  }
  return out;
}

/** Parses a 5-field cron expression. Supports `*`, lists, ranges, steps and month/weekday names. */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new CronParseError('cron must have exactly 5 fields');
  const [m, h, dom, mon, dow] = fields as [string, string, string, string, string];
  const dayOfWeek = parseCronField(dow, 0, 7, 'day-of-week', DOW_NAMES);
  if (dayOfWeek.has(7)) {
    dayOfWeek.delete(7);
    dayOfWeek.add(0);
  }
  return {
    minute: parseCronField(m, 0, 59, 'minute'),
    hour: parseCronField(h, 0, 23, 'hour'),
    dayOfMonth: parseCronField(dom, 1, 31, 'day-of-month'),
    month: parseCronField(mon, 1, 12, 'month', MONTH_NAMES),
    dayOfWeek,
    dayOfMonthAny: dom === '*' || dom.startsWith('*/'),
    dayOfWeekAny: dow === '*' || dow.startsWith('*/'),
  };
}

export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  /** 0-6, Sunday = 0. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock parts of `date` in `timeZone`. Falls back to UTC for an unknown zone. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
      });
    } catch {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
      });
    }
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(date)) parts[p.type] = p.value;
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour) % 24,
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: WEEKDAY_INDEX[parts.weekday ?? 'Sun'] ?? 0,
  };
}

/** Whether the cron expression fires during the minute containing `at`, in `timeZone`. */
export function cronIsDue(expression: string | ParsedCron, at: Date, timeZone = 'UTC'): boolean {
  const cron = typeof expression === 'string' ? parseCron(expression) : expression;
  const p = zonedParts(at, timeZone);
  if (!cron.minute.has(p.minute) || !cron.hour.has(p.hour) || !cron.month.has(p.month))
    return false;
  const domMatch = cron.dayOfMonth.has(p.day);
  const dowMatch = cron.dayOfWeek.has(p.weekday);
  if (cron.dayOfMonthAny && cron.dayOfWeekAny) return true;
  if (cron.dayOfMonthAny) return dowMatch;
  if (cron.dayOfWeekAny) return domMatch;
  return domMatch || dowMatch;
}

/** Start of the UTC minute containing `date`. */
export function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

// ---------------------------------------------------------------------------
// Templates: {{ path.to.value }}
// ---------------------------------------------------------------------------

export const TEMPLATE_ROOTS = ['trigger', 'input', 'steps', 'vars', 'organization'] as const;
const TEMPLATE_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const SAFE_PATH_RE = /^[A-Za-z_][\w-]*(?:\.[\w-]+|\[\d+\])*$/;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
export const MAX_TEMPLATE_VALUE_CHARS = 20_000;

/** Resolves `a.b[0].c` against `context`. Returns `undefined` for unsafe/unknown paths. Never walks prototypes. */
export function resolvePath(context: unknown, path: string): unknown {
  if (!SAFE_PATH_RE.test(path)) return undefined;
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s !== '');
  let current: unknown = context;
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    text = String(value);
  } else {
    try {
      text = JSON.stringify(value) ?? '';
    } catch {
      text = '';
    }
  }
  return text.length > MAX_TEMPLATE_VALUE_CHARS ? text.slice(0, MAX_TEMPLATE_VALUE_CHARS) : text;
}

/** Replaces every `{{ path }}` with the stringified value (missing values become an empty string). */
export function renderTemplate(template: string, context: unknown): string {
  return template.replace(TEMPLATE_RE, (_m, path: string) =>
    stringifyTemplateValue(resolvePath(context, path)),
  );
}

/** Like `renderTemplate`, but a template that is exactly one `{{ path }}` returns the raw value (typed). */
export function renderTemplateValue(template: string, context: unknown): unknown {
  const single = /^\s*\{\{\s*([^{}]*?)\s*\}\}\s*$/.exec(template);
  if (single) return resolvePath(context, single[1]!);
  return renderTemplate(template, context);
}

/** Recursively renders every string in a JSON-like value. */
export function renderDeep(value: unknown, context: unknown): unknown {
  if (typeof value === 'string') return renderTemplate(value, context);
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, context));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_SEGMENTS.has(k)) continue;
      out[k] = renderDeep(v, context);
    }
    return out;
  }
  return value;
}

/** All `{{ path }}` expressions inside a string. */
export function templatePaths(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TEMPLATE_RE)) out.push(m[1]!);
  return out;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type ConditionOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'exists';

function numeric(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function evaluateCondition(left: string, operator: ConditionOperator, right = ''): boolean {
  switch (operator) {
    case 'exists':
      return left.trim() !== '' && left.trim() !== 'null' && left.trim() !== 'undefined';
    case 'eq': {
      const a = numeric(left);
      const b = numeric(right);
      return a !== null && b !== null ? a === b : left === right;
    }
    case 'neq':
      return !evaluateCondition(left, 'eq', right);
    case 'contains':
      return left.toLowerCase().includes(right.toLowerCase());
    case 'gt': {
      const a = numeric(left);
      const b = numeric(right);
      return a !== null && b !== null && a > b;
    }
    case 'lt': {
      const a = numeric(left);
      const b = numeric(right);
      return a !== null && b !== null && a < b;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Workflow definition validation (used before create/activate and by the workers as a safety net)
// ---------------------------------------------------------------------------

export interface WorkflowValidationIssue {
  /** Step id the issue relates to, or `null` for trigger/workflow-level issues. */
  stepId: string | null;
  path: string;
  message: string;
}

export const WORKFLOW_LIMITS = {
  maxSteps: 30,
  maxExecutionMs: 15 * 60_000,
  maxHttpStepMs: 60_000,
  /** Sum of all `delay` steps may not exceed 7 days. */
  maxTotalDelaySeconds: 7 * 86_400,
} as const;

function collectStrings(
  value: unknown,
  path: string,
  out: Array<{ path: string; text: string }>,
): void {
  if (typeof value === 'string') out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, path ? `${path}.${k}` : k, out);
  }
}

export function validateWorkflowDefinition(
  trigger: WorkflowTrigger,
  steps: readonly WorkflowStep[],
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const add = (stepId: string | null, path: string, message: string) =>
    issues.push({ stepId, path, message });

  if (trigger.type === 'schedule') {
    try {
      parseCron(trigger.cron);
    } catch (e) {
      add(null, 'trigger.cron', e instanceof Error ? e.message : 'Invalid cron expression');
    }
  }
  if (steps.length === 0) add(null, 'steps', 'A workflow needs at least one step');
  if (steps.length > WORKFLOW_LIMITS.maxSteps) {
    add(null, 'steps', `A workflow can have at most ${WORKFLOW_LIMITS.maxSteps} steps`);
  }

  const indexById = new Map<string, number>();
  steps.forEach((step, i) => {
    if (indexById.has(step.id)) add(step.id, `steps[${i}].id`, `Duplicate step id "${step.id}"`);
    else indexById.set(step.id, i);
  });

  let totalDelay = 0;
  steps.forEach((step, i) => {
    const p = `steps[${i}]`;
    if (step.type === 'delay') totalDelay += step.seconds;

    if (step.type === 'condition') {
      for (const branch of ['then', 'else'] as const) {
        step[branch].forEach((target, j) => {
          const targetIndex = indexById.get(target);
          if (targetIndex === undefined) {
            add(step.id, `${p}.${branch}[${j}]`, `Unknown step id "${target}"`);
          } else if (targetIndex <= i) {
            add(step.id, `${p}.${branch}[${j}]`, `Step "${target}" must come after the condition`);
          }
        });
      }
      const overlap = step.then.filter((t) => step.else.includes(t));
      if (overlap.length > 0) {
        add(step.id, `${p}`, `Step(s) ${overlap.join(', ')} appear in both branches`);
      }
      if (step.operator !== 'exists' && (step.right === undefined || step.right === '')) {
        add(step.id, `${p}.right`, `Operator "${step.operator}" needs a right operand`);
      }
    }
    if (step.type === 'update_lead') {
      if (!step.status && !step.assigneeId && step.addTags.length === 0) {
        add(step.id, p, 'update_lead needs at least one of status, assigneeId or addTags');
      }
    }
    if (step.type === 'create_task') {
      if (step.reminderBeforeHours !== undefined && step.dueInHours === undefined) {
        add(step.id, `${p}.reminderBeforeHours`, 'reminderBeforeHours requires dueInHours');
      } else if (
        step.reminderBeforeHours !== undefined &&
        step.dueInHours !== undefined &&
        step.reminderBeforeHours > step.dueInHours
      ) {
        add(
          step.id,
          `${p}.reminderBeforeHours`,
          'The reminder cannot be earlier than the run time',
        );
      }
    }
    if (step.type === 'http_request' && !step.url.includes('{{')) {
      if (
        !/^https:\/\//i.test(step.url) &&
        !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(step.url)
      ) {
        add(step.id, `${p}.url`, 'URL must start with https:// (http only for localhost)');
      }
    }
    if (step.type === 'outbound_webhook') {
      if (!(ALL_DOMAIN_EVENTS as readonly string[]).includes(step.event)) {
        add(
          step.id,
          `${p}.event`,
          `"${step.event}" is not a known event (${ALL_DOMAIN_EVENTS.join(', ')})`,
        );
      }
    }
    if (step.type === 'set_variable' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(step.name)) {
      add(step.id, `${p}.name`, 'Variable names may contain letters, digits and underscores only');
    }

    // Template references
    const strings: Array<{ path: string; text: string }> = [];
    collectStrings(step, p, strings);
    for (const { path, text } of strings) {
      if (text.split('{{').length !== text.split('}}').length) {
        add(step.id, path, 'Unbalanced {{ }} in template');
        continue;
      }
      for (const expr of templatePaths(text)) {
        if (!SAFE_PATH_RE.test(expr)) {
          add(step.id, path, `Invalid template expression "{{ ${expr} }}"`);
          continue;
        }
        const root = expr.split(/[.[]/)[0]!;
        if (!(TEMPLATE_ROOTS as readonly string[]).includes(root)) {
          add(step.id, path, `Unknown template root "${root}" (use ${TEMPLATE_ROOTS.join(', ')})`);
          continue;
        }
        if (root === 'steps') {
          const refId = expr.split(/[.[]/)[1];
          const refIndex = refId ? indexById.get(refId) : undefined;
          if (refIndex === undefined)
            add(step.id, path, `Template references unknown step "${refId ?? ''}"`);
          else if (refIndex >= i)
            add(step.id, path, `Template references step "${refId}" which runs later`);
        }
      }
    }
  });
  if (totalDelay > WORKFLOW_LIMITS.maxTotalDelaySeconds) {
    add(null, 'steps', 'Total delay across steps may not exceed 7 days');
  }
  return issues;
}
