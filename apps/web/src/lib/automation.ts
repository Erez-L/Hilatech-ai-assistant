import {
  Bell,
  Bot,
  Clock,
  GitBranch,
  Globe,
  Send,
  StickyNote,
  UserCog,
  ListTodo,
  Variable,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from 'lucide-react';
import type {
  DomainEvent,
  WorkflowRunStatus,
  WorkflowStep,
  WorkflowTrigger,
} from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';
import { extractIssues } from '@/lib/forms/server-errors';
import { isApiError } from '@/lib/api/client';
import { msg, type Msg } from '@/i18n/msg';
import type { T } from '@/i18n/provider';
import { en, type MessageKey } from '@/i18n/messages';

/** Mirrors the API's template placeholder: resource ids the user must choose before activation. */
export const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

export type StepType = WorkflowStep['type'];
export type TriggerType = WorkflowTrigger['type'];

export const STEP_META: Record<StepType, { label: Msg; description: Msg; icon: LucideIcon }> = {
  agent_run: {
    label: msg('automations.step.agent_run'),
    description: msg('automations.step.agent_run.description'),
    icon: Bot,
  },
  send_notification: {
    label: msg('automations.step.send_notification'),
    description: msg('automations.step.send_notification.description'),
    icon: Bell,
  },
  http_request: {
    label: msg('automations.step.http_request'),
    description: msg('automations.step.http_request.description'),
    icon: Globe,
  },
  update_lead: {
    label: msg('automations.step.update_lead'),
    description: msg('automations.step.update_lead.description'),
    icon: UserCog,
  },
  create_lead_note: {
    label: msg('automations.step.create_lead_note'),
    description: msg('automations.step.create_lead_note.description'),
    icon: StickyNote,
  },
  delay: {
    label: msg('automations.step.delay'),
    description: msg('automations.step.delay.description'),
    icon: Clock,
  },
  condition: {
    label: msg('automations.step.condition'),
    description: msg('automations.step.condition.description'),
    icon: GitBranch,
  },
  n8n_trigger: {
    label: msg('automations.step.n8n_trigger'),
    description: msg('automations.step.n8n_trigger.description'),
    icon: WorkflowIcon,
  },
  outbound_webhook: {
    label: msg('automations.step.outbound_webhook'),
    description: msg('automations.step.outbound_webhook.description'),
    icon: Send,
  },
  create_task: {
    label: msg('automations.step.create_task'),
    description: msg('automations.step.create_task.description'),
    icon: ListTodo,
  },
  set_variable: {
    label: msg('automations.step.set_variable'),
    description: msg('automations.step.set_variable.description'),
    icon: Variable,
  },
};

export const STEP_TYPES = Object.keys(STEP_META) as StepType[];

export const TRIGGER_LABELS: Record<TriggerType, Msg> = {
  manual: msg('automations.trigger.manual'),
  event: msg('automations.trigger.event'),
  schedule: msg('automations.trigger.schedule'),
  webhook: msg('automations.trigger.webhook'),
};

export const RUN_STATUS_LABELS: Record<WorkflowRunStatus, Msg> = {
  queued: msg('automations.runStatus.queued'),
  running: msg('automations.runStatus.running'),
  succeeded: msg('automations.runStatus.succeeded'),
  failed: msg('automations.runStatus.failed'),
  cancelled: msg('automations.runStatus.cancelled'),
};

export const RUN_STATUS_TONES: Record<WorkflowRunStatus, StatusTone> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export const CONDITION_OPERATORS = [
  { value: 'eq', label: msg('automations.operator.eq') },
  { value: 'neq', label: msg('automations.operator.neq') },
  { value: 'contains', label: msg('automations.operator.contains') },
  { value: 'gt', label: msg('automations.operator.gt') },
  { value: 'lt', label: msg('automations.operator.lt') },
  { value: 'exists', label: msg('automations.operator.exists') },
] as const;

/** Event name → readable label (`lead.status_changed` → "Lead status changed"). */
export function eventLabel(event: string, t?: T): string {
  const key = `automations.event.${event}` as MessageKey;
  if (t && key in en) return t(key);
  const text = event.replace(/[._]+/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function triggerSummary(trigger: WorkflowTrigger, t: T): string {
  switch (trigger.type) {
    case 'manual':
      return t(TRIGGER_LABELS.manual);
    case 'event':
      return t('automations.onEvent', { event: eventLabel(trigger.event as DomainEvent, t) });
    case 'schedule':
      return t('automations.scheduleCron', { cron: trigger.cron });
    case 'webhook':
      return t(TRIGGER_LABELS.webhook);
  }
}

export function stepSummary(step: WorkflowStep, t: T): string {
  switch (step.type) {
    case 'agent_run':
      return step.input ? truncate(step.input) : t('automations.noInputYet');
    case 'send_notification':
      return step.title ? truncate(step.title) : t('automations.noTitleYet');
    case 'http_request':
      return `${step.method} ${step.url || '…'}`;
    case 'update_lead':
      return (
        [
          step.status && t('automations.summaryStatus', { status: step.status }),
          step.assigneeId && t('automations.summaryReassign'),
          step.addTags.length > 0 && t('automations.summaryTags', { count: step.addTags.length }),
        ]
          .filter(Boolean)
          .join(', ') || t('automations.noChangesYet')
      );
    case 'create_lead_note':
      return step.body ? truncate(step.body) : t('automations.noNoteYet');
    case 'delay':
      return t('automations.summaryWait', { seconds: step.seconds });
    case 'condition':
      return `${truncate(step.left || '…')} ${step.operator}${step.right ? ` ${truncate(step.right)}` : ''}`;
    case 'n8n_trigger':
      return step.webhook || t('automations.noWebhookYet');
    case 'outbound_webhook':
      return step.event || t('automations.noEventYet');
    case 'set_variable':
      return step.name ? `vars.${step.name}` : t('automations.noNameYet');
    case 'create_task':
      return step.title ? truncate(step.title) : t('automations.noTitleYet');
  }
}

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A fresh step of a type with values the form can start from. */
export function newStep(type: StepType, id: string): WorkflowStep {
  switch (type) {
    case 'agent_run':
      return { id, type, agentId: '', input: '', wait: true };
    case 'send_notification':
      return { id, type, to: { kind: 'assignee' }, title: '' };
    case 'http_request':
      return { id, type, method: 'POST', url: '', headers: {}, timeoutMs: 15000 };
    case 'update_lead':
      return { id, type, leadId: '{{ trigger.payload.leadId }}', addTags: [] };
    case 'create_lead_note':
      return { id, type, leadId: '{{ trigger.payload.leadId }}', body: '' };
    case 'delay':
      return { id, type, seconds: 60 };
    case 'condition':
      return { id, type, left: '', operator: 'eq', right: '', then: [], else: [] };
    case 'n8n_trigger':
      return { id, type, webhook: '', payload: {} };
    case 'outbound_webhook':
      return { id, type, event: '', payload: {} };
    case 'create_task':
      return { id, type, title: '', priority: 'medium' };
    case 'set_variable':
      return { id, type, name: '', value: '' };
  }
}

/** `http-1`, `http-2`… the first id of that stem not used by any existing step. */
export function uniqueStepId(type: StepType, existing: readonly string[]): string {
  const stem = type.replace(/_/g, '-');
  let n = 1;
  while (existing.includes(`${stem}-${n}`)) n += 1;
  return `${stem}-${n}`;
}

export interface Placeholder {
  /** Stable key for form state. */
  key: string;
  stepId: string;
  kind: 'agent' | 'user';
  label: string;
}

/** Template fields still holding the placeholder id (must be chosen by the user before saving). */
export function findPlaceholders(steps: readonly WorkflowStep[], t: T): Placeholder[] {
  const out: Placeholder[] = [];
  for (const step of steps) {
    if (step.type === 'agent_run' && step.agentId === PLACEHOLDER_ID) {
      out.push({
        key: `${step.id}.agentId`,
        stepId: step.id,
        kind: 'agent',
        label: t('automations.agentForStep', { id: step.id }),
      });
    }
    if (
      step.type === 'send_notification' &&
      step.to.kind === 'user' &&
      step.to.userId === PLACEHOLDER_ID
    ) {
      out.push({
        key: `${step.id}.userId`,
        stepId: step.id,
        kind: 'user',
        label: t('automations.userToNotify', { id: step.id }),
      });
    }
  }
  return out;
}

export function applyPlaceholders(
  steps: readonly WorkflowStep[],
  values: Record<string, string>,
): WorkflowStep[] {
  return steps.map((step) => {
    if (step.type === 'agent_run' && step.agentId === PLACEHOLDER_ID) {
      return { ...step, agentId: values[`${step.id}.agentId`] ?? step.agentId };
    }
    if (
      step.type === 'send_notification' &&
      step.to.kind === 'user' &&
      step.to.userId === PLACEHOLDER_ID
    ) {
      return {
        ...step,
        to: { kind: 'user', userId: values[`${step.id}.userId`] ?? step.to.userId },
      };
    }
    return step;
  });
}

// ---------------------------------------------------------------------------------------------
// Validation issues
// ---------------------------------------------------------------------------------------------

export interface WorkflowIssue {
  stepId: string | null;
  path: string;
  message: string;
}

/** `steps[1].then[0]` or `steps.1.timeoutMs` → { index: 1, rest: 'then[0]' | 'timeoutMs' }. */
export function parseIssuePath(path: string): { index: number | null; rest: string } {
  const match = /^steps(?:\[(\d+)\]|\.(\d+))\.?(.*)$/.exec(path);
  if (!match) return { index: null, rest: path };
  return { index: Number(match[1] ?? match[2]), rest: match[3] ?? '' };
}

/**
 * Converts an API error from save/validate/enable into issues keyed by step id. Handles both the
 * workflow validator (`details.issues[{stepId,path,message}]`) and zod-style details (`steps.0.url`).
 */
export function issuesFromError(error: unknown, stepIds: readonly string[]): WorkflowIssue[] {
  if (!isApiError(error) || !error.isValidation) return [];
  const details = error.details as { issues?: unknown } | unknown[] | undefined;
  const raw =
    details && !Array.isArray(details) && Array.isArray((details as { issues?: unknown }).issues)
      ? ((details as { issues: WorkflowIssue[] }).issues as WorkflowIssue[])
      : null;
  if (raw && raw.every((i) => typeof i === 'object' && i !== null && 'message' in i)) {
    return raw.map((i) => ({ stepId: i.stepId ?? null, path: i.path ?? '', message: i.message }));
  }
  return extractIssues(error.details).map((i) => {
    const { index } = parseIssuePath(i.path);
    return {
      stepId: index !== null ? (stepIds[index] ?? null) : null,
      path: i.path,
      message: i.message,
    };
  });
}
