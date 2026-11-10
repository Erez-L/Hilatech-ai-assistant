'use client';

import * as React from 'react';
import Link from 'next/link';
import { Play, Plus, Sparkles, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
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
import { useT, useFormat } from '@/i18n/provider';

const PAGE_SIZE = 20;

export function WorkflowsView() {
  const t = useT();
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
            placeholder={t('automations.searchWorkflows')}
            aria-label={t('automations.searchWorkflows')}
            className="w-full sm:max-w-xs"
          />
          <div className="w-40">
            <NativeSelect
              aria-label={t('automations.filterByState')}
              value={enabled}
              onChange={(e) => {
                setEnabled(e.target.value as '' | 'true' | 'false');
                setPage(1);
              }}
            >
              <option value="">{t('common.allWorkflows')}</option>
              <option value="true">{t('common.enabled')}</option>
              <option value="false">{t('common.disabled')}</option>
            </NativeSelect>
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button asChild variant="secondary" leadingIcon={<Sparkles aria-hidden />}>
              <Link href="/automations/templates">{t('automations.fromATemplate')}</Link>
            </Button>
            <Button asChild leadingIcon={<Plus aria-hidden />}>
              <Link href="/automations/new">{t('automations.newWorkflow')}</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table aria-label={t('automations.workflows')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.workflow')}</TableHead>
                <TableHead>{t('common.trigger')}</TableHead>
                <TableHead>{t('common.runs')}</TableHead>
                <TableHead>{t('common.lastRun')}</TableHead>
                <TableHead>{t('common.enabled')}</TableHead>
                <TableHead className="text-end">
                  <span className="sr-only">{t('common.actions')}</span>
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
                      {t('common.tryAgain')}
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : workflows.data.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<WorkflowIcon />}
                    title={
                      filtered ? t('automations.noWorkflowsMatch') : t('automations.noWorkflowsYet')
                    }
                    description={
                      filtered
                        ? t('automations.tryADifferentSearchOr')
                        : t('automations.startFromATemplateOr')
                    }
                    action={
                      !filtered && canManage ? (
                        <Button asChild size="sm" leadingIcon={<Sparkles aria-hidden />}>
                          <Link href="/automations/templates">
                            {t('automations.browseTemplates')}
                          </Link>
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
        title={t('automations.deleteThisWorkflow')}
        description={
          deleting ? t('automations.willBeRemovedItsPast', { name: deleting.name }) : undefined
        }
        confirmLabel={t('automations.deleteWorkflow')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t('automations.workflowDeleted', { name: deleting.name }));
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
  const fmt = useFormat();
  const t = useT();
  const setEnabled = useSetWorkflowEnabled();
  const toggle = (next: boolean) =>
    setEnabled.mutate(
      { id: workflow.id, enabled: next },
      {
        onSuccess: () =>
          toast.success(
            t(next ? 'agents.agentEnabled' : 'agents.agentDisabled', { name: workflow.name }),
          ),
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
            {workflow.steps.length}{' '}
            {workflow.steps.length === 1 ? t('automations.step') : t('automations.steps')}
            {workflow.steps[0]
              ? t('automations.startsWith', {
                  name: t(STEP_META[workflow.steps[0].type].label).toLowerCase(),
                })
              : ''}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{triggerSummary(workflow.trigger, t)}</Badge>
      </TableCell>
      <TableCell className="tabular">{workflow.runCount}</TableCell>
      <TableCell className="text-fg-muted">
        {workflow.lastRunAt ? fmt.relative(new Date(workflow.lastRunAt)) : t('automations.never')}
      </TableCell>
      <TableCell>
        <Switch
          checked={workflow.isEnabled}
          disabled={!canManage || setEnabled.isPending}
          aria-label={t(workflow.isEnabled ? 'common.disableName' : 'common.enableName', {
            name: workflow.name,
          })}
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
                aria-label={t('common.run2', { name: workflow.name })}
                title={workflow.isEnabled ? undefined : t('common.enableTheWorkflowToRun')}
                onClick={onRun}
              >
                {t('common.run')}
              </Button>
              <IconButton
                size="sm"
                label={t('common.delete2', { name: workflow.name })}
                onClick={onDelete}
              >
                <Trash2 aria-hidden />
              </IconButton>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
