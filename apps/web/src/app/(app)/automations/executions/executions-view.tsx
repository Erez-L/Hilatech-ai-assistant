'use client';

import * as React from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
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
import type { Formatter } from '@/i18n/format';
import { useT, useFormat } from '@/i18n/provider';

const PAGE_SIZE = 20;

export function formatDuration(ms: number | null, fmt: Formatter): string {
  if (ms === null) return '—';
  return fmt.duration(ms);
}

export function ExecutionsView() {
  const fmt = useFormat();
  const t = useT();
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
              aria-label={t('automations.filterByWorkflow')}
              value={workflowId}
              onChange={(e) => {
                setWorkflowId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('common.allWorkflows')}</option>
              {(workflows.data?.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="sm:w-48">
            <NativeSelect
              aria-label={t('common.filterByStatus')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as WorkflowRunStatus | '');
                setPage(1);
              }}
            >
              <option value="">{t('common.allStatuses')}</option>
              {WorkflowRunStatus.options.map((s) => (
                <option key={s} value={s}>
                  {t(RUN_STATUS_LABELS[s])}
                </option>
              ))}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table aria-label={t('automations.workflowExecutions')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.workflow')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{t('common.trigger')}</TableHead>
                <TableHead>{t('common.steps')}</TableHead>
                <TableHead>{t('common.started')}</TableHead>
                <TableHead className="text-end">{t('common.duration')}</TableHead>
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
                      {t('common.tryAgain')}
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : executions.data.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<History />}
                    title={
                      filtered
                        ? t('automations.noExecutionsMatch')
                        : t('automations.noExecutionsYet')
                    }
                    description={
                      filtered
                        ? t('common.tryDifferentFilters')
                        : t('automations.runAWorkflowOrWait')
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
                        aria-label={t('automations.openExecutionOf', {
                          name: e.workflow?.name ?? t('automations.deletedWorkflow'),
                        })}
                      >
                        {e.workflow?.name ?? t('automations.deletedWorkflow')}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {typeof e.trigger?.type === 'string'
                        ? triggerSummary(e.trigger as unknown as WorkflowTrigger, t)
                        : '—'}
                    </TableCell>
                    <TableCell className="tabular">{e.stepResults.length}</TableCell>
                    <TableCell className="text-fg-muted">
                      {fmt.relative(new Date(e.createdAt))}
                    </TableCell>
                    <TableCell className="text-end tabular">
                      {formatDuration(e.durationMs, fmt)}
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
