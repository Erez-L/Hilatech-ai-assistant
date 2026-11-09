'use client';

import * as React from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { WorkflowRunStatus } from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  NativeSelect,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useWorkflowExecutions, useWorkflows } from '@/hooks/automation';
import { RunStatusBadge } from '@/components/automation/run-status-badge';
import { RUN_STATUS_LABELS, triggerSummary } from '@/lib/automation';
import type { WorkflowTrigger } from '@hilatech/contracts';

const PAGE_SIZE = 20;

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function ExecutionsView() {
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<WorkflowRunStatus | ''>('');
  const [workflowId, setWorkflowId] = React.useState('');
  const workflows = useWorkflows({ pageSize: 100 });
  const executions = useWorkflowExecutions({
    page,
    pageSize: PAGE_SIZE,
    status: status || undefined,
    workflowId: workflowId || undefined,
  });
  const columns = 6;
  const filtered = !!status || !!workflowId;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <div className="sm:w-60">
            <NativeSelect
              aria-label="Filter by workflow"
              value={workflowId}
              onChange={(e) => {
                setWorkflowId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All workflows</option>
              {(workflows.data?.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="sm:w-48">
            <NativeSelect
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as WorkflowRunStatus | '');
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {WorkflowRunStatus.options.map((s) => (
                <option key={s} value={s}>
                  {RUN_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table aria-label="Workflow executions">
            <TableHeader>
              <TableRow>
                <TableHead>Workflow</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.isPending ? (
                <TableSkeletonRows columns={columns} rows={5} />
              ) : executions.isError ? (
                <TableEmptyRow colSpan={columns}>
                  <div className="flex flex-col items-center gap-2">
                    <span>{getErrorMessage(executions.error)}</span>
                    <Button variant="secondary" size="sm" onClick={() => void executions.refetch()}>
                      Try again
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : executions.data.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<History />}
                    title={filtered ? 'No executions match' : 'No executions yet'}
                    description={
                      filtered
                        ? 'Try different filters.'
                        : 'Run a workflow, or wait for its trigger, and the run shows up here.'
                    }
                  />
                </TableEmptyRow>
              ) : (
                executions.data.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link
                        href={`/automations/executions/${e.id}`}
                        className="font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-label={`Open execution of ${e.workflow?.name ?? 'deleted workflow'}`}
                      >
                        {e.workflow?.name ?? 'Deleted workflow'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {typeof e.trigger?.type === 'string'
                        ? triggerSummary(e.trigger as unknown as WorkflowTrigger)
                        : '—'}
                    </TableCell>
                    <TableCell className="tabular">{e.stepResults.length}</TableCell>
                    <TableCell className="text-fg-muted">
                      {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatDuration(e.durationMs)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {executions.data && executions.data.meta.total > PAGE_SIZE ? (
            <div className="border-t border-border px-5 py-3">
              <Pagination
                page={executions.data.meta.page}
                pageSize={executions.data.meta.pageSize}
                total={executions.data.meta.total}
                onPageChange={setPage}
                itemLabel="executions"
              />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
