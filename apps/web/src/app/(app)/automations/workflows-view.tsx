'use client';

import * as React from 'react';
import Link from 'next/link';
import { Play, Plus, Sparkles, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Permission, type Workflow } from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  IconButton,
  NativeSelect,
  Pagination,
  SearchInput,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useDeleteWorkflow, useSetWorkflowEnabled, useWorkflows } from '@/hooks/automation';
import { useCan } from '@/hooks/use-can';
import { RunWorkflowDialog } from '@/components/automation/run-workflow-dialog';
import { STEP_META, triggerSummary } from '@/lib/automation';

const PAGE_SIZE = 20;

export function WorkflowsView() {
  const canManage = useCan(Permission.AUTOMATIONS_MANAGE);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [enabled, setEnabled] = React.useState<'' | 'true' | 'false'>('');
  const [runTarget, setRunTarget] = React.useState<Workflow | null>(null);
  const [deleting, setDeleting] = React.useState<Workflow | null>(null);
  const remove = useDeleteWorkflow();
  const workflows = useWorkflows({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    isEnabled: enabled === '' ? undefined : enabled === 'true',
  });
  const filtered = !!search || enabled !== '';
  const columns = 6;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <SearchInput
            value={search}
            onValueChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search workflows"
            aria-label="Search workflows"
            className="w-full sm:max-w-xs"
          />
          <div className="w-40">
            <NativeSelect
              aria-label="Filter by state"
              value={enabled}
              onChange={(e) => {
                setEnabled(e.target.value as '' | 'true' | 'false');
                setPage(1);
              }}
            >
              <option value="">All workflows</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </NativeSelect>
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button asChild variant="secondary" leadingIcon={<Sparkles aria-hidden />}>
              <Link href="/automations/templates">From a template</Link>
            </Button>
            <Button asChild leadingIcon={<Plus aria-hidden />}>
              <Link href="/automations/new">New workflow</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table aria-label="Workflows">
            <TableHeader>
              <TableRow>
                <TableHead>Workflow</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.isPending ? (
                <TableSkeletonRows columns={columns} rows={5} />
              ) : workflows.isError ? (
                <TableEmptyRow colSpan={columns}>
                  <div className="flex flex-col items-center gap-2">
                    <span>{getErrorMessage(workflows.error)}</span>
                    <Button variant="secondary" size="sm" onClick={() => void workflows.refetch()}>
                      Try again
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : workflows.data.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<WorkflowIcon />}
                    title={filtered ? 'No workflows match' : 'No workflows yet'}
                    description={
                      filtered
                        ? 'Try a different search or filter.'
                        : 'Start from a template or build a workflow from scratch.'
                    }
                    action={
                      !filtered && canManage ? (
                        <Button asChild size="sm" leadingIcon={<Sparkles aria-hidden />}>
                          <Link href="/automations/templates">Browse templates</Link>
                        </Button>
                      ) : undefined
                    }
                  />
                </TableEmptyRow>
              ) : (
                workflows.data.data.map((wf) => (
                  <WorkflowRow
                    key={wf.id}
                    workflow={wf}
                    canManage={canManage}
                    onRun={() => setRunTarget(wf)}
                    onDelete={() => setDeleting(wf)}
                  />
                ))
              )}
            </TableBody>
          </Table>
          {workflows.data && workflows.data.meta.total > PAGE_SIZE ? (
            <div className="border-t border-border px-5 py-3">
              <Pagination
                page={workflows.data.meta.page}
                pageSize={workflows.data.meta.pageSize}
                total={workflows.data.meta.total}
                onPageChange={setPage}
                itemLabel="workflows"
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {runTarget ? (
        <RunWorkflowDialog
          workflow={runTarget}
          open
          onOpenChange={(open) => !open && setRunTarget(null)}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this workflow?"
        description={
          deleting
            ? `“${deleting.name}” will be removed. Its past executions stay in the history.`
            : undefined
        }
        confirmLabel="Delete workflow"
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(`Workflow “${deleting.name}” deleted`);
            setDeleting(null);
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
    </div>
  );
}

function WorkflowRow({
  workflow,
  canManage,
  onRun,
  onDelete,
}: {
  workflow: Workflow;
  canManage: boolean;
  onRun: () => void;
  onDelete: () => void;
}) {
  const setEnabled = useSetWorkflowEnabled();
  const toggle = (next: boolean) =>
    setEnabled.mutate(
      { id: workflow.id, enabled: next },
      {
        onSuccess: () => toast.success(`${workflow.name} ${next ? 'enabled' : 'disabled'}`),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/automations/${workflow.id}`}
            className="truncate font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {workflow.name}
          </Link>
          <span className="line-clamp-1 text-xs text-fg-muted">
            {workflow.steps.length} {workflow.steps.length === 1 ? 'step' : 'steps'}
            {workflow.steps[0]
              ? ` · starts with ${STEP_META[workflow.steps[0].type].label.toLowerCase()}`
              : ''}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{triggerSummary(workflow.trigger)}</Badge>
      </TableCell>
      <TableCell className="tabular">{workflow.runCount}</TableCell>
      <TableCell className="text-fg-muted">
        {workflow.lastRunAt
          ? formatDistanceToNow(new Date(workflow.lastRunAt), { addSuffix: true })
          : 'Never'}
      </TableCell>
      <TableCell>
        <Switch
          checked={workflow.isEnabled}
          disabled={!canManage || setEnabled.isPending}
          aria-label={`${workflow.isEnabled ? 'Disable' : 'Enable'} ${workflow.name}`}
          onCheckedChange={toggle}
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {canManage ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Play aria-hidden />}
                disabled={!workflow.isEnabled}
                aria-label={`Run ${workflow.name}`}
                title={workflow.isEnabled ? undefined : 'Enable the workflow to run it'}
                onClick={onRun}
              >
                Run
              </Button>
              <IconButton size="sm" label={`Delete ${workflow.name}`} onClick={onDelete}>
                <Trash2 aria-hidden />
              </IconButton>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
