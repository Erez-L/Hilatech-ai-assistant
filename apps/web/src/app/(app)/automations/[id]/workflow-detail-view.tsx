'use client';

import { ErrorState, Skeleton } from '@hilatech/ui';
import { isApiError } from '@/lib/api';
import { useWorkflow } from '@/hooks/automation';
import { QueryState } from '@/components/common/query-state';
import { WorkflowEditor } from '@/components/automation/workflow-editor';

export function WorkflowDetailView({ id }: { id: string }) {
  const workflow = useWorkflow(id);
  if (workflow.isError && isApiError(workflow.error) && workflow.error.isNotFound) {
    return (
      <ErrorState
        title="Workflow not found"
        message="It may have been deleted, or it belongs to another organization."
      />
    );
  }
  return (
    <QueryState
      query={workflow}
      errorTitle="This workflow couldn’t be loaded"
      loading={
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading workflow">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      }
    >
      {/* key: reset the editor when another workflow (or a refetched definition) is shown */}
      {(w) => <WorkflowEditor key={`${w.id}-${w.updatedAt}`} workflow={w} />}
    </QueryState>
  );
}
