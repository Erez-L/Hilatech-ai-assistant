'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, History, Play, Plus } from 'lucide-react';
import { Permission, type Agent, type AgentExecution } from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
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
import { useAgentExecutions, useAgents, useAiProviders, useUpdateAgent } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { PermissionGate } from '@/components/common/permission-gate';
import { ExecutionStatusBadge } from '@/components/ai/badges';
import { RunAgentDialog } from './run-agent-dialog';
import { useT } from '@/i18n/provider';

const PAGE_SIZE = 20;

export function AgentsView() {
  const t = useT();
  const router = useRouter();
  const canManage = useCan(Permission.AGENTS_MANAGE);
  const canExecute = useCan(Permission.AGENTS_EXECUTE);
  const canReadConfig = useCan(Permission.AI_CONFIG_READ);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [runTarget, setRunTarget] = React.useState<Agent | null>(null);

  const agents = useAgents({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const providers = useAiProviders({ enabled: canReadConfig });
  // Latest root run per agent (the API has no per-agent "last run" field).
  const runs = useAgentExecutions({ rootOnly: true, page: 1, pageSize: 100 });
  const lastRun = React.useMemo(() => {
    const map = new Map<string, AgentExecution>();
    for (const e of runs.data?.data ?? []) {
      const prev = map.get(e.agentId);
      if (!prev || e.createdAt > prev.createdAt) map.set(e.agentId, e);
    }
    return map;
  }, [runs.data]);
  const providerName = (id: string | null) =>
    id
      ? (providers.data?.find((p) => p.id === id)?.name ?? t('agents.customProvider'))
      : t('agents.defaultProvider');

  const columns = 6;
  return (
    <PermissionGate anyOf={[Permission.AGENTS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('agents.agents')}
          description={t('agents.autonomousWorkersWithClearInstructions')}
          actions={
            <>
              <Button asChild variant="secondary" leadingIcon={<History aria-hidden />}>
                <Link href="/agents/executions">{t('agents.runHistory')}</Link>
              </Button>
              {canManage ? (
                <Button asChild leadingIcon={<Plus aria-hidden />}>
                  <Link href="/agents/new">{t('agents.newAgent')}</Link>
                </Button>
              ) : null}
            </>
          }
        />

        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            <SearchInput
              value={search}
              onValueChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder={t('agents.searchAgents')}
              aria-label={t('agents.searchAgents')}
              className="max-w-sm"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.agent')}</TableHead>
                  <TableHead>{t('common.model')}</TableHead>
                  <TableHead>{t('agents.tools')}</TableHead>
                  <TableHead>{t('common.lastRun')}</TableHead>
                  <TableHead>{t('common.enabled')}</TableHead>
                  <TableHead className="text-end">
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.isPending ? (
                  <TableSkeletonRows columns={columns} rows={6} />
                ) : agents.isError ? (
                  <TableEmptyRow colSpan={columns}>
                    <div className="flex flex-col items-center gap-2">
                      <span>{getErrorMessage(agents.error)}</span>
                      <Button variant="secondary" size="sm" onClick={() => void agents.refetch()}>
                        {t('common.tryAgain')}
                      </Button>
                    </div>
                  </TableEmptyRow>
                ) : agents.data.data.length === 0 ? (
                  <TableEmptyRow colSpan={columns} className="py-4">
                    <EmptyState
                      compact
                      icon={<Bot />}
                      title={search ? t('agents.noAgentsMatch') : t('agents.noAgentsYet')}
                      description={
                        search
                          ? t('common.tryADifferentSearchTerm')
                          : t('agents.createAnAgentToAutomate')
                      }
                      action={
                        !search && canManage ? (
                          <Button asChild size="sm" leadingIcon={<Plus aria-hidden />}>
                            <Link href="/agents/new">{t('agents.newAgent')}</Link>
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableEmptyRow>
                ) : (
                  agents.data.data.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      providerName={providerName(agent.providerConfigId)}
                      lastRun={lastRun.get(agent.id)}
                      canManage={canManage}
                      canExecute={canExecute}
                      onRun={() => setRunTarget(agent)}
                      onOpen={() => router.push(`/agents/${agent.id}`)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
            {agents.data && agents.data.meta.total > PAGE_SIZE ? (
              <div className="border-t border-border px-5 py-3">
                <Pagination
                  page={agents.data.meta.page}
                  pageSize={agents.data.meta.pageSize}
                  total={agents.data.meta.total}
                  onPageChange={setPage}
                  itemLabel="agents"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {runTarget ? (
          <RunAgentDialog
            agent={runTarget}
            open
            onOpenChange={(open) => !open && setRunTarget(null)}
          />
        ) : null}
      </div>
    </PermissionGate>
  );
}

function AgentRow({
  agent,
  providerName,
  lastRun,
  canManage,
  canExecute,
  onRun,
  onOpen,
}: {
  agent: Agent;
  providerName: string;
  lastRun?: AgentExecution;
  canManage: boolean;
  canExecute: boolean;
  onRun: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  const update = useUpdateAgent();
  return (
    <TableRow
      className="cursor-pointer"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a,button,[role="switch"]')) return;
        onOpen();
      }}
    >
      <TableCell>
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/agents/${agent.id}`}
            className="truncate font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {agent.name}
          </Link>
          {agent.description ? (
            <span className="line-clamp-1 text-xs text-fg-muted">{agent.description}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm">{agent.model ?? t('agents.providerDefault')}</span>
          <span className="text-xs text-fg-muted">{providerName}</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="tabular">
          {agent.tools.length} {agent.tools.length === 1 ? t('agents.tool') : t('agents.tools2')}
        </Badge>
      </TableCell>
      <TableCell>
        {lastRun ? (
          <Link
            href={`/agents/executions/${lastRun.id}`}
            className="inline-flex"
            aria-label={t('agents.lastRun', { status: lastRun.status })}
          >
            <ExecutionStatusBadge status={lastRun.status} />
          </Link>
        ) : (
          <span className="text-fg-subtle">{t('agents.noRuns')}</span>
        )}
      </TableCell>
      <TableCell>
        <Switch
          checked={agent.isEnabled}
          disabled={!canManage || update.isPending}
          aria-label={t(agent.isEnabled ? 'common.disableName' : 'common.enableName', {
            name: agent.name,
          })}
          onCheckedChange={(isEnabled) =>
            update.mutate(
              { id: agent.id, body: { isEnabled } },
              {
                onSuccess: () =>
                  toast.success(
                    t(isEnabled ? 'agents.agentEnabled' : 'agents.agentDisabled', {
                      name: agent.name,
                    }),
                  ),
                onError: (e) => toast.error(getErrorMessage(e)),
              },
            )
          }
        />
      </TableCell>
      <TableCell className="text-end">
        {canExecute ? (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Play aria-hidden />}
            disabled={!agent.isEnabled}
            aria-label={t('common.run2', { name: agent.name })}
            onClick={onRun}
          >
            {t('common.run')}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
