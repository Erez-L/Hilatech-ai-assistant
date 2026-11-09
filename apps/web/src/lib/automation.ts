import {
  Bell,
  Bot,
  Clock,
  GitBranch,
  Globe,
  Send,
  StickyNote,
  UserCog,
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

/** Mirrors the API's template placeholder: resource ids the user must choose before activation. */
export const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

export type StepType = WorkflowStep['type'];
export type TriggerType = WorkflowTrigger['type'];

export const STEP_META: Record<StepType, { label: string; description: string; icon: LucideIcon }> =
  {
    agent_run: { label: 'Run an agent', description: 'Hand a task to an AI agent', icon: Bot },
    send_notification: {
      label: 'Send a notification',
      description: 'In-app notification to a user, role or assignee',
      icon: Bell,
    },
    http_request: { label: 'HTTP request', description: 'Call an external API', icon: Globe },
    update_lead: {
      label: 'Update a lead',
      description: 'Change status, assignee or tags',
      icon: UserCog,
    },
    create_lead_note: {
      label: 'Add a lead note',
      description: 'Record a note on a lead',
      icon: StickyNote,
    },
    delay: { label: 'Wait', description: 'Pause before the next step', icon: Clock },
    condition: { label: 'Condition', description: 'Branch on a value', icon: GitBranch },
    n8n_trigger: { label: 'Trigger n8n', description: 'Call an n8n webhook', icon: WorkflowIcon },
    outbound_webhook: {
      label: 'Send outbound webhook',
      description: 'Emit an event to subscribers',
      icon: Send,
    },
    set_variable: {
      label: 'Set variable',
      description: 'Store a value for later steps',
      icon: Variable,
    },
  };

export const STEP_TYPES = Object.keys(STEP_META) as StepType[];

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  manual: 'Manual',
  event: 'Event',
  schedule: 'Schedule',
  webhook: 'Inbound webhook',
};

export const RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const RUN_STATUS_TONES: Record<WorkflowRunStatus, StatusTone> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export const CONDITION_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: 'is greater than' },
  { value: 'lt', label: 'is less than' },
  { value: 'exists', label: 'exists' },
] as const;

/** Event name → readable label (`lead.status_changed` → "Lead status changed"). */
export function eventLabel(event: string): string {
  const text = event.replace(/[._]+/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function triggerSummary(trigger: WorkflowTrigger): string {
  switch (trigger.type) {
    case 'manual':
      return 'Manual';
    case 'event':
      return `On ${eventLabel(trigger.event as DomainEvent).toLowerCase()}`;
    case 'schedule':
      return `Schedule ${trigger.cron}`;
    case 'webhook':
      return 'Inbound webhook';
  }
}

export function stepSummary(step: WorkflowStep): string {
  switch (step.type) {
    case 'agent_run':
      return step.input ? truncate(step.input) : 'No input yet';
    case 'send_notification':
      return step.title ? truncate(step.title) : 'No title yet';
    case 'http_request':
      return `${step.method} ${step.url || '…'}`;
    case 'update_lead':
      return (
        [
          step.status && `status → ${step.status}`,
          step.assigneeId && 'reassign',
          step.addTags.length > 0 && `+${step.addTags.length} tags`,
        ]
          .filter(Boolean)
          .join(', ') || 'No changes yet'
      );
    case 'create_lead_note':
      return step.body ? truncate(step.body) : 'No note yet';
    case 'delay':
      return `Wait ${step.seconds}s`;
    case 'condition':
      return `${truncate(step.left || '…')} ${step.operator}${step.right ? ` ${truncate(step.right)}` : ''}`;
    case 'n8n_trigger':
      return step.webhook || 'No webhook yet';
    case 'outbound_webhook':
      return step.event || 'No event yet';
    case 'set_variable':
      return step.name ? `vars.${step.name}` : 'No name yet';
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
export function findPlaceholders(steps: readonly WorkflowStep[]): Placeholder[] {
  const out: Placeholder[] = [];
  for (const step of steps) {
    if (step.type === 'agent_run' && step.agentId === PLACEHOLDER_ID) {
      out.push({
        key: `${step.id}.agentId`,
        stepId: step.id,
        kind: 'agent',
        label: `Agent for step “${step.id}”`,
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
        label: `User to notify in step “${step.id}”`,
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
