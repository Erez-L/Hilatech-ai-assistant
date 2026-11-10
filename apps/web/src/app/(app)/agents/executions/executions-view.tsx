'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FilterX, History } from 'lucide-react';
import { Permission, type AgentExecutionStatus } from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Label,
  NativeSelect,
  PageHeader,
  Pagination,
  Switch,
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
import { useAgentExecutions, useAgents } from '@/hooks/queries';
import {
  EXECUTION_STATUSES,
  EXECUTION_STATUS_LABELS,
  TRIGGER_LABELS,
  formatDuration,
  formatUsd,
} from '@/lib/ai';
import { PermissionGate } from '@/components/common/permission-gate';
import { ExecutionStatusBadge } from '@/components/ai/badges';
import { useT, useFormat } from '@/i18n/provider';
import { tm } from '@/i18n/msg';

const PAGE_SIZE = 20;

export function ExecutionsView() {
  const fmt = useFormat();
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [page, setPage] = React.useState(1);
  const [agentId, setAgentId] = React.useState(searchParams.get('agentId') ?? '');
  const [status, setStatus] = React.useState<AgentExecutionStatus | ''>('');
  const [rootOnly, setRootOnly] = React.useState(true);

  const agents = useAgents({ page: 1, pageSize: 100 });
  const executions = useAgentExecutions(
    {
      page,
      pageSize: PAGE_SIZE,
      agentId: agentId || undefined,
      status: status || undefined,
      rootOnly,
    },
    { refetchInterval: 10_000 },
  );

  const hasFilters = !!(agentId || status || !rootOnly);
  const reset = () => {
    setAgentId('');
    setStatus('');
    setRootOnly(true);
    setPage(1);
  };
  const columns = 7;

  return (
    <PermissionGate anyOf={[Permission.AGENTS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={
            <Link href="/agents" className="inline-flex items-center gap-1 hover:text-fg">
              <ArrowLeft className="size-3.5" aria-hidden />
              {t('agents.agents')}
            </Link>
          }
          title={t('agents.agentRuns')}
          description={t('agents.everyExecutionWithStatusCost')}
        />
        <Card>
          <CardContent className="grid gap-4 py-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto] xl:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exec-agent">{t('common.agent')}</Label>
              <NativeSelect
                id="exec-agent"
                value={agentId}
                onChange={(e) => {
                  setAgentId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">{t('agents.allAgents')}</option>
                {(agents.data?.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exec-status">{t('common.status')}</Label>
              <NativeSelect
                id="exec-status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as AgentExecutionStatus | '');
                  setPage(1);
                }}
              >
                <option value="">{t('common.allStatuses')}</option>
                {EXECUTION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(EXECUTION_STATUS_LABELS[s])}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-center gap-2.5 pb-2">
              <Switch
                id="exec-root-only"
                checked={rootOnly}
                onCheckedChange={(v) => {
                  setRootOnly(v);
                  setPage(1);
                }}
              />
              <Label htmlFor="exec-root-only" className="font-normal">
                {t('agents.topLevelRunsOnly')}
              </Label>
            </div>
            <Button
              variant="ghost"
              onClick={reset}
              disabled={!hasFilters}
              leadingIcon={<FilterX aria-hidden />}
            >
              {t('common.clear')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.agent')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.trigger')}</TableHead>
                  <TableHead>{t('common.started')}</TableHead>
                  <TableHead>{t('common.duration')}</TableHead>
                  <TableHead className="text-end">{t('common.tokens')}</TableHead>
                  <TableHead className="text-end">{t('common.cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.isPending ? (
                  <TableSkeletonRows columns={columns} rows={8} />
                ) : executions.isError ? (
                  <TableEmptyRow colSpan={columns}>
                    <div className="flex flex-col items-center gap-2">
                      <span>{getErrorMessage(executions.error)}</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void executions.refetch()}
                      >
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
                        hasFilters ? t('agents.noRunsMatchTheseFilters') : t('agents.noRunsYet')
                      }
                      description={
                        hasFilters ? t('common.tryDifferentFilters') : t('agents.runAnAgentFromThe')
                      }
                      action={
                        hasFilters ? (
                          <Button size="sm" variant="secondary" onClick={reset}>
                            {t('common.clearFilters')}
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableEmptyRow>
                ) : (
                  executions.data.data.map((e) => (
                    <TableRow
                      key={e.id}
                      className="cursor-pointer"
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('a,button')) return;
                        router.push(`/agents/executions/${e.id}`);
                      }}
                    >
                      <TableCell>
                        <Link
                          href={`/agents/executions/${e.id}`}
                          className="font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {e.agent?.name ?? t('common.deletedAgent')}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <ExecutionStatusBadge status={e.status} />
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {tm(t, TRIGGER_LABELS[e.trigger] ?? e.trigger)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-fg-muted tabular">
                        <time
                          dateTime={e.startedAt ?? e.createdAt}
                          title={fmt.dateTime(new Date(e.startedAt ?? e.createdAt), 'long')}
                        >
                          {fmt.relative(new Date(e.startedAt ?? e.createdAt))}
                        </time>
                      </TableCell>
                      <TableCell className="tabular">{formatDuration(e.durationMs, fmt)}</TableCell>
                      <TableCell className="text-end tabular">
                        {fmt.number(e.inputTokens + e.outputTokens)}
                      </TableCell>
                      <TableCell className="text-end tabular">
                        {formatUsd(e.estimatedCostUsd, fmt)}
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
                  itemLabel="runs"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </PermissionGate>
  );
}
