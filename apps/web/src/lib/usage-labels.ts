import type { UsageMetric } from '@hilatech/contracts';
import { msg, type Msg } from '@/i18n/msg';

export const USAGE_LABELS: Record<UsageMetric, { label: Msg; unit: 'count' | 'mb' }> = {
  ai_tokens: { label: msg('usage.ai_tokens'), unit: 'count' },
  agent_executions: { label: msg('usage.agent_executions'), unit: 'count' },
  documents: { label: msg('usage.documents'), unit: 'count' },
  storage_mb: { label: msg('usage.storage_mb'), unit: 'mb' },
  automation_runs: { label: msg('usage.automation_runs'), unit: 'count' },
};
