import type { UsageMetric } from '@hilatech/contracts';
import { formatBytesFromMb, formatCompact } from '@hilatech/ui';

export const USAGE_LABELS: Record<UsageMetric, { label: string; format: (n: number) => string }> = {
  ai_tokens: { label: 'AI tokens', format: formatCompact },
  agent_executions: { label: 'Agent runs', format: formatCompact },
  documents: { label: 'Knowledge documents', format: formatCompact },
  storage_mb: { label: 'Storage', format: formatBytesFromMb },
  automation_runs: { label: 'Automation runs', format: formatCompact },
};
