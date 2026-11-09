'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
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

export function ExecutionDetailView({ id }: { id: string }) {
  const execution = useAgentExecution(id);
  return (
    <PermissionGate anyOf={[Permission.AGENTS_READ]}>
      <QueryState
        query={execution}
        loading={<DetailSkeleton />}
        errorTitle="This run couldn’t be loaded"
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
            Agent runs
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {execution.agent ? (
              <Link href={`/agents/${execution.agent.id}`} className="hover:underline">
                {execution.agent.name}
              </Link>
            ) : (
              'Deleted agent'
            )}
            <ExecutionStatusBadge status={execution.status} className="translate-y-0.5" />
          </span>
        }
        description={
          live
            ? 'This run is still in progress; the page refreshes every 2 seconds.'
            : `Finished ${execution.finishedAt ? format(new Date(execution.finishedAt), 'PPpp') : ''}`.trim()
        }
        actions={
          live && canExecute ? (
            <Button
              variant="danger-outline"
              leadingIcon={<Square aria-hidden />}
              onClick={() => setConfirmOpen(true)}
            >
              Cancel run
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Trigger" value={TRIGGER_LABELS[execution.trigger] ?? execution.trigger} />
            <Stat label="Duration" value={formatDuration(execution.durationMs)} />
            <Stat label="Steps" value={String(execution.stepCount)} />
            <Stat
              label="Tokens"
              value={tokens.toLocaleString('en')}
              hint={`${execution.inputTokens.toLocaleString('en')} in · ${execution.outputTokens.toLocaleString('en')} out`}
            />
            <Stat
              label="Estimated cost"
              value={formatUsd(execution.estimatedCostUsd)}
              hint={execution.estimatedCostUsd == null ? 'No pricing configured' : undefined}
            />
            <Stat
              label="Started"
              value={
                execution.startedAt ? format(new Date(execution.startedAt), 'd MMM, HH:mm:ss') : '—'
              }
            />
          </dl>
        </CardContent>
      </Card>

      {execution.error ? (
        <Alert tone="danger" title="This run did not complete">
          {execution.error}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Input</CardTitle>
          </CardHeader>
          <CardContent>
            <Payload value={execution.input} empty="No input" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Output</CardTitle>
          </CardHeader>
          <CardContent>
            <Payload
              value={execution.output}
              empty={live ? 'The output appears when the run finishes.' : 'No output'}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
          <CardDescription>Every model call, tool call and delegation, in order.</CardDescription>
        </CardHeader>
        <CardContent>
          {execution.steps.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {live ? 'Waiting for the first step…' : 'This run recorded no steps.'}
            </p>
          ) : (
            <Timeline aria-label="Steps">
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
            <CardTitle>Delegations</CardTitle>
            <CardDescription>Runs started by this agent for sub-tasks.</CardDescription>
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
        title="Cancel this run?"
        description="A queued run is cancelled immediately; a running one stops at its next safe point. Work already done is kept."
        confirmLabel="Cancel run"
        tone="danger"
        loading={cancel.isPending}
        onConfirm={() => {
          cancel.mutate(execution.id, {
            onSuccess: () => {
              toast.success('Cancellation requested');
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
  const [open, setOpen] = React.useState(false);
  const hasDetails = step.input != null || step.output != null || !!step.error;
  const tokens = (step.inputTokens ?? 0) + (step.outputTokens ?? 0);
  return (
    <TimelineItem
      icon={STEP_ICONS[step.type]}
      tone={stepTone(step)}
      title={
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{step.name ?? STEP_TYPE_LABELS[step.type]}</span>
          <span className="text-xs text-fg-muted">
            {STEP_TYPE_LABELS[step.type]} · {step.status}
          </span>
        </span>
      }
      meta={
        <>
          {formatDuration(step.durationMs)}
          {tokens > 0 ? ` · ${tokens.toLocaleString('en')} tokens` : ''}
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
            {open ? 'Hide details' : 'Show details'}
          </button>
          {open ? (
            <div className="mt-2 flex flex-col gap-3">
              {step.input != null ? (
                <div>
                  <p className="mb-1 text-2xs font-medium text-fg-subtle uppercase">Input</p>
                  <Payload value={step.input} empty="No input" />
                </div>
              ) : null}
              {step.output != null ? (
                <div>
                  <p className="mb-1 text-2xs font-medium text-fg-subtle uppercase">Output</p>
                  <Payload value={step.output} empty="No output" />
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
  return (
    <li>
      <Link
        href={`/agents/executions/${child.id}`}
        className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="truncate font-medium">{child.agent?.name ?? 'Deleted agent'}</span>
          <ExecutionStatusBadge status={child.status} />
        </span>
        <span className="shrink-0 text-xs text-fg-muted tabular">
          {formatDuration(child.durationMs)} ·{' '}
          {(child.inputTokens + child.outputTokens).toLocaleString('en')} tokens
        </span>
      </Link>
    </li>
  );
}
