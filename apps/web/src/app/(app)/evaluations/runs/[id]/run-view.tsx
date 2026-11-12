'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  LoadingBlock,
  PageHeader,
  StatCard,
  toast,
} from '@hilatech/ui';
import { evaluationsApi, getErrorMessage, keys } from '@/lib/api';
import { useActiveOrganizationId } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { PermissionGate } from '@/components/common/permission-gate';
import { ResultStatusBadge, RunStatusBadge } from '@/components/evaluations/status-badges';
import { useT } from '@/i18n/provider';
import type { MessageKey } from '@/i18n/messages';

const ACTIVE = new Set(['queued', 'running']);

export function RunView({ id }: { id: string }) {
  const t = useT();
  const orgId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  const canRun = useCan(Permission.AGENTS_EXECUTE);

  const run = useQuery({
    queryKey: keys.evaluations(orgId, 'run', id),
    queryFn: () => evaluationsApi.run(id),
    enabled: !!orgId,
    refetchInterval: (query) =>
      query.state.data && ACTIVE.has(query.state.data.status) ? 2000 : false,
  });
  const cancel = useMutation({
    mutationFn: () => evaluationsApi.cancelRun(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.evaluations(orgId) });
      toast.success(t('evaluations.runCancelled'));
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (run.isLoading) return <LoadingBlock />;
  if (run.isError || !run.data) return <Alert tone="danger">{getErrorMessage(run.error)}</Alert>;
  const data = run.data;
  const active = ACTIVE.has(data.status);

  return (
    <PermissionGate anyOf={[Permission.AGENTS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={
            <Link
              href={`/evaluations/${data.datasetId}`}
              className="inline-flex items-center gap-1 hover:text-fg"
            >
              <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
              {data.datasetName}
            </Link>
          }
          title={
            <span className="flex flex-wrap items-center gap-3">
              {t('evaluations.runOf', { dataset: data.datasetName, agent: data.agentName })}
              <RunStatusBadge status={data.status} />
            </span>
          }
          actions={
            active && canRun ? (
              <Button
                variant="secondary"
                loading={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                {t('evaluations.cancelRun')}
              </Button>
            ) : null
          }
        />

        {data.error ? <Alert tone="danger">{data.error}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t('evaluations.passRate')}
            value={data.passRate !== null ? `${data.passRate}%` : '—'}
          />
          <StatCard label={t('evaluations.passed')} value={`${data.passed} / ${data.totalCases}`} />
          <StatCard label={t('evaluations.failed')} value={String(data.failed)} />
          <StatCard label={t('evaluations.errored')} value={String(data.errored)} />
        </div>

        {data.results.length === 0 ? (
          <p className="text-sm text-fg-muted" role="status">
            {active ? t('evaluations.waitingForResults') : t('evaluations.noRuns')}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.results.map((r) => (
              <li key={r.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{r.caseName}</span>
                      <ResultStatusBadge status={r.status} />
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-fg-muted">{r.input}</p>
                    <div className="rounded-sm border border-border bg-surface-muted p-3 text-sm">
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
                        {t('evaluations.output')}
                      </div>
                      <p className="whitespace-pre-wrap" dir="auto">
                        {r.output ?? r.error ?? t('evaluations.noOutput')}
                      </p>
                    </div>
                    <ul className="flex flex-col gap-1 text-sm">
                      {r.checks.map((check, i) => (
                        <li key={i} className="flex items-start gap-2">
                          {check.passed ? (
                            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                          ) : (
                            <X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                          )}
                          <span>
                            {t(`evaluations.check.${check.type}` as MessageKey)}:{' '}
                            <bdi className="font-mono text-xs">{check.value}</bdi>
                            <span className="sr-only">
                              {' — '}
                              {t(
                                check.passed
                                  ? 'evaluations.result.passed'
                                  : 'evaluations.result.failed',
                              )}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {r.executionId ? (
                      <Link
                        href={`/agents/executions/${r.executionId}`}
                        className="text-sm text-accent hover:underline"
                      >
                        {t('evaluations.viewExecution')}
                      </Link>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PermissionGate>
  );
}
