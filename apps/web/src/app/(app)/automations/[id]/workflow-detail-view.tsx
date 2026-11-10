'use client';

import { ErrorState, Skeleton } from '@hilatech/ui';
import { isApiError } from '@/lib/api';
import { useWorkflow } from '@/hooks/automation';
import { QueryState } from '@/components/common/query-state';
import { WorkflowEditor } from '@/components/automation/workflow-editor';
import { useT } from '@/i18n/provider';

export function WorkflowDetailView({ id }: { id: string }) {
  const t = useT();
  const workflow = useWorkflow(id);
  if (workflow.isError && isApiError(workflow.error) && workflow.error.isNotFound) {
    return (
      <ErrorState
        title={t('automations.workflowNotFound')}
        message={t('common.itMayHaveBeenDeleted')}
      />
    );
  }
  return (
    <QueryState
      query={workflow}
      errorTitle={t('automations.thisWorkflowCouldnTBe')}
      loading={
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label={t('automations.loadingWorkflow')}
        >
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
