'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  Flag,
  Share2,
  Sparkles,
  Square,
  Wrench,
} from 'lucide-react';
import {
  Permission,
  type AgentExecution,
  type AgentExecutionDetail,
  type AgentExecutionStep,
  type AgentStepType,
} from '@hilatech/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  JsonViewer,
  PageHeader,
  Skeleton,
  Timeline,
  TimelineItem,
  cn,
  toast,
  type TimelineTone,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { isTerminalExecution, useAgentExecution, useCancelExecution } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { STEP_TYPE_LABELS, TRIGGER_LABELS, formatDuration, formatUsd } from '@/lib/ai';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { ExecutionStatusBadge } from '@/components/ai/badges';
import { Markdown } from '@/components/ai/markdown';
import { useT, useFormat } from '@/i18n/provider';
import { tm } from '@/i18n/msg';

export function ExecutionDetailView({ id }: { id: string }) {
  const t = useT();
  const execution = useAgentExecution(id);
  return (
    <PermissionGate anyOf={[Permission.AGENTS_READ]}>
      <QueryState
        query={execution}
        loading={<DetailSkeleton />}
        errorTitle={t('agents.thisRunCouldnTBe')}
      >
        {(data) => <ExecutionDetail execution={data} />}
      </QueryState>
    </PermissionGate>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}

const STEP_ICONS: Record<AgentStepType, React.ReactNode> = {
  llm_call: <Sparkles />,
  tool_call: <Wrench />,
  delegation: <Share2 />,
  final: <Flag />,
  error: <CircleAlert />,
};

function stepTone(step: AgentExecutionStep): TimelineTone {
  if (step.error || /fail|error|denied|timed/i.test(step.status)) return 'danger';
  if (/running|pending|queued/i.test(step.status)) return 'info';
  if (step.type === 'final') return 'success';
  return 'neutral';
}

function ExecutionDetail({ execution }: { execution: AgentExecutionDetail }) {
  const t = useT();
  const fmt = useFormat();
  const canExecute = useCan(Permission.AGENTS_EXECUTE);
  const cancel = useCancelExecution();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const live = !isTerminalExecution(execution.status);
  const tokens = execution.inputTokens + execution.outputTokens;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/agents/executions" className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3.5" aria-hidden />
            {t('agents.agentRuns')}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {execution.agent ? (
              <Link href={`/agents/${execution.agent.id}`} className="hover:underline">
                {execution.agent.name}
              </Link>
            ) : (
              t('common.deletedAgent')
            )}
            <ExecutionStatusBadge status={execution.status} className="translate-y-0.5" />
          </span>
        }
        description={
          live
            ? t('agents.thisRunIsStillIn')
            : execution.finishedAt
              ? t('agents.finishedAt', {
                  when: fmt.dateTime(new Date(execution.finishedAt), 'long'),
                })
              : ''
        }
        actions={
          live && canExecute ? (
            <Button
              variant="danger-outline"
              leadingIcon={<Square aria-hidden />}
              onClick={() => setConfirmOpen(true)}
            >
              {t('agents.cancelRun')}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label={t('common.trigger')}
              value={tm(t, TRIGGER_LABELS[execution.trigger] ?? execution.trigger)}
            />
            <Stat label={t('common.duration')} value={formatDuration(execution.durationMs, fmt)} />
            <Stat label={t('common.steps')} value={String(execution.stepCount)} />
            <Stat
              label={t('common.tokens')}
              value={fmt.number(tokens)}
              hint={t('agents.inOut', {
                number: fmt.number(execution.inputTokens),
                number2: fmt.number(execution.outputTokens),
              })}
            />
            <Stat
              label={t('common.estimatedCost')}
              value={formatUsd(execution.estimatedCostUsd, fmt)}
              hint={
                execution.estimatedCostUsd == null ? t('common.noPricingConfigured') : undefined
              }
            />
            <Stat
              label={t('common.started')}
              value={
                execution.startedAt ? fmt.dateTime(new Date(execution.startedAt), 'long') : '—'
              }
            />
          </dl>
        </CardContent>
      </Card>

      {execution.error ? (
        <Alert tone="danger" title={t('agents.thisRunDidNotComplete')}>
          {execution.error}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('common.input')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Payload value={execution.input} empty={t('agents.noInput')} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('agents.output')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Payload
              value={execution.output}
              empty={live ? t('agents.outputAppearsWhenFinished') : t('agents.noOutput')}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('common.steps')}</CardTitle>
          <CardDescription>{t('agents.everyModelCallToolCall')}</CardDescription>
        </CardHeader>
        <CardContent>
          {execution.steps.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {live ? t('agents.waitingForTheFirstStep') : t('agents.thisRunRecordedNoSteps')}
            </p>
          ) : (
            <Timeline aria-label={t('common.steps')}>
              {execution.steps.map((step) => (
                <StepItem key={step.id} step={step} />
              ))}
            </Timeline>
          )}
        </CardContent>
      </Card>

      {execution.children.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('agents.delegations')}</CardTitle>
            <CardDescription>{t('agents.runsStartedByThisAgent')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {execution.children.map((child) => (
                <ChildRow key={child.id} child={child} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('agents.cancelThisRun')}
        description={t('agents.aQueuedRunIsCancelled')}
        confirmLabel={t('agents.cancelRun')}
        tone="danger"
        loading={cancel.isPending}
        onConfirm={() => {
          cancel.mutate(execution.id, {
            onSuccess: () => {
              toast.success(t('agents.cancellationRequested'));
              setConfirmOpen(false);
            },
            onError: (e) => {
              toast.error(getErrorMessage(e));
              setConfirmOpen(false);
            },
          });
        }}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="font-medium tabular">{value}</dd>
      {hint ? <p className="text-2xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

function Payload({ value, empty }: { value: unknown; empty: string }) {
  if (value == null || value === '') return <p className="text-sm text-fg-subtle">{empty}</p>;
  if (typeof value === 'string') return <Markdown source={value} className="text-sm" />;
  return <JsonViewer value={value} emptyLabel={empty} maxHeight={320} />;
}

function StepItem({ step }: { step: AgentExecutionStep }) {
  const t = useT();
  const fmt = useFormat();
  const [open, setOpen] = React.useState(false);
  const hasDetails = step.input != null || step.output != null || !!step.error;
  const tokens = (step.inputTokens ?? 0) + (step.outputTokens ?? 0);
  return (
    <TimelineItem
      icon={STEP_ICONS[step.type]}
      tone={stepTone(step)}
      title={
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{step.name ?? t(STEP_TYPE_LABELS[step.type])}</span>
          <span className="text-xs text-fg-muted">
            {t(STEP_TYPE_LABELS[step.type])} · {step.status}
          </span>
        </span>
      }
      meta={
        <>
          {formatDuration(step.durationMs, fmt)}
          {tokens > 0 ? t('agents.tokens', { number: fmt.number(tokens) }) : ''}
        </>
      }
    >
      {step.error ? <p className="text-xs text-danger">{step.error}</p> : null}
      {hasDetails ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-xs text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
              aria-hidden
            />
            {open ? t('common.hideDetails') : t('common.showDetails')}
          </button>
          {open ? (
            <div className="mt-2 flex flex-col gap-3">
              {step.input != null ? (
                <div>
                  <p className="mb-1 text-2xs font-medium text-fg-subtle uppercase">
                    {t('common.input')}
                  </p>
                  <Payload value={step.input} empty={t('agents.noInput')} />
                </div>
              ) : null}
              {step.output != null ? (
                <div>
                  <p className="mb-1 text-2xs font-medium text-fg-subtle uppercase">
                    {t('agents.output')}
                  </p>
                  <Payload value={step.output} empty={t('agents.noOutput')} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </TimelineItem>
  );
}

function ChildRow({ child }: { child: AgentExecution }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <li>
      <Link
        href={`/agents/executions/${child.id}`}
        className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="truncate font-medium">
            {child.agent?.name ?? t('common.deletedAgent')}
          </span>
          <ExecutionStatusBadge status={child.status} />
        </span>
        <span className="shrink-0 text-xs text-fg-muted tabular">
          {t('agents.durationTokens', {
            duration: formatDuration(child.durationMs, fmt),
            tokens: fmt.number(child.inputTokens + child.outputTokens),
          })}
        </span>
      </Link>
    </li>
  );
}
