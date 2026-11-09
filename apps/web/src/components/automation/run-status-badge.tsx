import { Loader2 } from 'lucide-react';
import type { WorkflowRunStatus } from '@hilatech/contracts';
import { StatusBadge } from '@hilatech/ui';
import { RUN_STATUS_LABELS, RUN_STATUS_TONES } from '@/lib/automation';

export function RunStatusBadge({ status }: { status: WorkflowRunStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge
        status={status}
        tone={RUN_STATUS_TONES[status]}
        label={RUN_STATUS_LABELS[status]}
      />
      {status === 'running' ? (
        <Loader2 className="size-3.5 animate-spin text-fg-muted" aria-hidden />
      ) : null}
    </span>
  );
}
