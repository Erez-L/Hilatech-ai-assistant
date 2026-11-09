import type { AgentExecutionStatus, AgentStepType, ToolRiskLevel } from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';

export const EXECUTION_STATUSES: AgentExecutionStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
];

export const EXECUTION_STATUS_LABELS: Record<AgentExecutionStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Cancelled',
};

export const EXECUTION_STATUS_TONES: Record<AgentExecutionStatus, StatusTone> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  timed_out: 'warning',
  cancelled: 'neutral',
};

export const STEP_TYPE_LABELS: Record<AgentStepType, string> = {
  llm_call: 'Model call',
  tool_call: 'Tool call',
  delegation: 'Delegation',
  final: 'Final answer',
  error: 'Error',
};

export const RISK_LABELS: Record<ToolRiskLevel, string> = {
  read: 'Read',
  write: 'Write',
  dangerous: 'Dangerous',
};

export const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual',
  api: 'API',
  automation: 'Automation',
  agent: 'Delegated by agent',
  schedule: 'Schedule',
};

/** 850 ms · 4.2 s · 2 min 5 s. Null → “—”. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

/** Estimated cost in USD, or “—” when the API reports no pricing for the model(s). */
export function formatUsd(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

/** Extracts `{{variable}}` names from a prompt template, in order of first appearance. */
export function extractTemplateVariables(content: string): string[] {
  const found = new Set<string>();
  for (const m of content.matchAll(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g)) found.add(m[1] as string);
  return Array.from(found);
}
