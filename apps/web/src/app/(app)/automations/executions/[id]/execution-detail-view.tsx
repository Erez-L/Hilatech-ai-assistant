'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  JsonViewer,
  Skeleton,
  StatusBadge,
  Button,
} from '@hilatech/ui';
import { isApiError } from '@/lib/api';
import { useWorkflowExecution } from '@/hooks/automation';
import { QueryState } from '@/components/common/query-state';
import { RunStatusBadge } from '@/components/automation/run-status-badge';
import { STEP_META, type StepType } from '@/lib/automation';
import { formatDuration } from '../executions-view';
import { useT, useFormat } from '@/i18n/provider';

export function ExecutionDetailView({ id }: { id: string }) {
  const fmt = useFormat();
  const t = useT();
  const execution = useWorkflowExecution(id);
  if (execution.isError && isApiError(execution.error) && execution.error.isNotFound) {
    return (
      <ErrorState
        title={t('automations.executionNotFound')}
        message={t('automations.itMayBelongToAnother')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="self-start"
        leadingIcon={<ArrowLeft aria-hidden />}
      >
        <Link href="/automations/executions">{t('automations.allExecutions')}</Link>
      </Button>
      <QueryState
        query={execution}
        errorTitle={t('automations.thisExecutionCouldnTBe')}
        loading={
          <div
            className="flex flex-col gap-3"
            aria-busy="true"
            aria-label={t('automations.loadingExecution')}
          >
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-32" />
            <Skeleton className="h-48" />
          </div>
        }
      >
        {(e) => (
          <>
            <header className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold">
                  {e.workflow ? (
                    <Link href={`/automations/${e.workflow.id}`} className="hover:underline">
                      {e.workflow.name}
                    </Link>
                  ) : (
                    t('automations.deletedWorkflow')
                  )}
                </h2>
                <RunStatusBadge status={e.status} />
              </div>
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg-muted">
                <div className="flex gap-1.5">
                  <dt>{t('common.started')}</dt>
                  <dd className="text-fg">
                    {e.startedAt
                      ? fmt.dateTime(new Date(e.startedAt), 'long')
                      : t('automations.notStarted')}
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>{t('common.duration')}</dt>
                  <dd className="text-fg tabular">{formatDuration(e.durationMs, fmt)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>{t('automations.attempt')}</dt>
                  <dd className="text-fg tabular">{e.attempt}</dd>
                </div>
              </dl>
            </header>

            {e.error ? <Alert tone="danger">{e.error}</Alert> : null}
            {e.status === 'queued' || e.status === 'running' ? (
              <Alert tone="info">
                <span role="status">{t('automations.thisRunIsThePage', { status: e.status })}</span>
              </Alert>
            ) : null}

            <section aria-labelledby="step-results-heading" className="flex flex-col gap-3">
              <h3 id="step-results-heading" className="text-base font-semibold">
                {t('automations.stepResults')}
              </h3>
              {e.stepResults.length === 0 ? (
                <p className="text-sm text-fg-muted">{t('automations.noStepsHaveRunYet')}</p>
              ) : (
                <ol aria-label={t('automations.stepResults')} className="flex flex-col gap-3">
                  {e.stepResults.map((r, i) => {
                    const meta = STEP_META[r.type as StepType];
                    return (
                      <li
                        key={`${r.stepId}-${i}`}
                        className="rounded-lg border border-border bg-surface p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular text-sm text-fg-subtle">{i + 1}.</span>
                          <span className="font-medium">{t(meta?.label ?? r.type)}</span>
                          <span className="font-mono text-xs text-fg-muted">{r.stepId}</span>
                          <StatusBadge
                            status={r.status}
                            tone={
                              r.status === 'succeeded'
                                ? 'success'
                                : r.status === 'failed'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          />
                          <Badge variant="outline" className="tabular">
                            {formatDuration(r.durationMs, fmt)}
                          </Badge>
                        </div>
                        {r.error ? <p className="mt-2 text-sm text-danger">{r.error}</p> : null}
                        {r.output !== null && r.output !== undefined ? (
                          <div className="mt-3">
                            <JsonViewer
                              value={r.output}
                              defaultExpandedDepth={1}
                              maxHeight={240}
                              aria-label={t('automations.outputOf', { stepId: r.stepId })}
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <div className="grid gap-4 lg:grid-cols-3">
              {(
                [
                  [t('automations.sectionTrigger'), e.trigger],
                  [t('automations.sectionInput'), e.input],
                  [t('automations.sectionOutput'), e.output],
                ] as const
              ).map(([title, value]) => (
                <Card key={title}>
                  <CardHeader>
                    <CardTitle>{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <JsonViewer
                      value={value}
                      emptyLabel={t('common.none')}
                      maxHeight={240}
                      aria-label={t('automations.json', { title })}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
