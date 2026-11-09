'use client';

import * as React from 'react';
import { ArrowDown, Play } from 'lucide-react';
import type { WorkflowStep, WorkflowTrigger } from '@hilatech/contracts';
import { Badge, cn } from '@hilatech/ui';
import { STEP_META, stepSummary, triggerSummary } from '@/lib/automation';

export interface FlowStep {
  /** Stable key (not the editable step id). */
  key: string;
  step: WorkflowStep;
  /** Number of validation problems on this step. */
  issueCount?: number;
}

/**
 * Read-only visual rendering of a workflow: the trigger followed by the steps in order. Condition
 * steps list the steps they branch to. Nodes are buttons that jump to the step's form.
 */
export function StepFlow({
  trigger,
  steps,
  onSelect,
}: {
  trigger: WorkflowTrigger;
  steps: FlowStep[];
  onSelect?: (key: string) => void;
}) {
  return (
    <ol aria-label="Workflow flow" className="flex flex-col items-stretch">
      <li className="flex flex-col items-center">
        <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft px-4 py-3">
          <Play className="size-4 shrink-0 text-accent-soft-fg" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-accent-soft-fg uppercase">
              Trigger
            </p>
            <p className="truncate text-sm font-medium">{triggerSummary(trigger)}</p>
          </div>
        </div>
      </li>
      {steps.map(({ key, step, issueCount = 0 }, index) => {
        const meta = STEP_META[step.type];
        const Icon = meta.icon;
        const failing = issueCount > 0;
        return (
          <li key={key} className="flex flex-col items-center">
            <Connector />
            <button
              type="button"
              onClick={() => onSelect?.(key)}
              aria-label={`Go to step ${index + 1}: ${meta.label} (${step.id})${failing ? `, ${issueCount} ${issueCount === 1 ? 'problem' : 'problems'}` : ''}`}
              className={cn(
                'flex w-full max-w-md items-start gap-3 rounded-lg border bg-surface px-4 py-3 text-left transition-colors',
                'hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                failing ? 'border-danger bg-danger-soft/40' : 'border-border',
              )}
            >
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="tabular text-fg-subtle">{index + 1}.</span>
                  {meta.label}
                  <span className="truncate font-mono text-xs font-normal text-fg-muted">
                    {step.id}
                  </span>
                </span>
                <span className="block truncate text-xs text-fg-muted">{stepSummary(step)}</span>
                {step.type === 'condition' ? (
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant="success">
                      then: {step.then.length ? step.then.join(', ') : 'continue'}
                    </Badge>
                    <Badge variant="neutral">
                      else: {step.else.length ? step.else.join(', ') : 'continue'}
                    </Badge>
                  </span>
                ) : null}
              </span>
              {failing ? (
                <Badge variant="danger" className="shrink-0">
                  {issueCount}
                </Badge>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Connector() {
  return (
    <div className="flex h-7 flex-col items-center text-fg-subtle" aria-hidden>
      <div className="w-px flex-1 bg-border-strong" />
      <ArrowDown className="-mt-1 size-3.5" />
    </div>
  );
}
