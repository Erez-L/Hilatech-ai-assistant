import type { AgentExecutionStatus, AgentStepType, ToolRiskLevel } from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';
import type { Formatter } from '@/i18n/format';
import { msg, type Msg } from '@/i18n/msg';

export const EXECUTION_STATUSES: AgentExecutionStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
];

export const EXECUTION_STATUS_LABELS: Record<AgentExecutionStatus, Msg> = {
  queued: msg('ai.executionStatus.queued'),
  running: msg('ai.executionStatus.running'),
  succeeded: msg('ai.executionStatus.succeeded'),
  failed: msg('ai.executionStatus.failed'),
  timed_out: msg('ai.executionStatus.timed_out'),
  cancelled: msg('ai.executionStatus.cancelled'),
};

export const EXECUTION_STATUS_TONES: Record<AgentExecutionStatus, StatusTone> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  timed_out: 'warning',
  cancelled: 'neutral',
};

export const STEP_TYPE_LABELS: Record<AgentStepType, Msg> = {
  llm_call: msg('ai.stepType.llm_call'),
  tool_call: msg('ai.stepType.tool_call'),
  delegation: msg('ai.stepType.delegation'),
  final: msg('ai.stepType.final'),
  error: msg('ai.stepType.error'),
};

export const RISK_LABELS: Record<ToolRiskLevel, Msg> = {
  read: msg('ai.risk.read'),
  write: msg('ai.risk.write'),
  dangerous: msg('ai.risk.dangerous'),
};

export const TRIGGER_LABELS: Record<string, Msg> = {
  manual: msg('ai.trigger.manual'),
  api: msg('ai.trigger.api'),
  automation: msg('ai.trigger.automation'),
  agent: msg('ai.trigger.agent'),
  schedule: msg('ai.trigger.schedule'),
};

/** 850 ms · 4.2 sec · 2.1 min (locale aware). Null → “—”. */
export function formatDuration(ms: number | null | undefined, fmt: Formatter): string {
  if (ms == null) return '—';
  return fmt.duration(ms);
}

/** Estimated cost in USD, or “—” when the API reports no pricing for the model(s). */
export function formatUsd(value: number | null | undefined, fmt: Formatter): string {
  if (value == null) return '—';
  return fmt.preciseCurrency(value, 'USD');
}

/** Extracts `{{variable}}` names from a prompt template, in order of first appearance. */
export function extractTemplateVariables(content: string): string[] {
  const found = new Set<string>();
  for (const m of content.matchAll(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g)) found.add(m[1] as string);
  return Array.from(found);
}
