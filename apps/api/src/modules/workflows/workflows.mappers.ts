import {
  type Workflow as WorkflowDto,
  type WorkflowExecution as WorkflowExecutionDto,
  type WorkflowStep,
  type WorkflowStepResult,
  type WorkflowTrigger,
  workflowStepResultSchema,
} from '@hilatech/contracts';
import { type Workflow, type WorkflowExecution } from '@hilatech/database';

export function toWorkflow(row: Workflow): WorkflowDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    isEnabled: row.isEnabled,
    trigger: row.trigger as unknown as WorkflowTrigger,
    steps: row.steps as unknown as WorkflowStep[],
    runCount: row.runCount,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ExecutionRow = WorkflowExecution & { workflow: { id: string; name: string } | null };

export function parseStepResults(value: unknown): WorkflowStepResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const parsed = workflowStepResultSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

export function toWorkflowExecution(row: ExecutionRow): WorkflowExecutionDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workflowId: row.workflowId,
    workflow: row.workflow ? { id: row.workflow.id, name: row.workflow.name } : null,
    status: row.status,
    trigger: (row.trigger ?? {}) as Record<string, unknown>,
    input: row.input,
    output: row.output ?? null,
    error: row.error,
    stepResults: parseStepResults(row.stepResults),
    attempt: row.attempt,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
