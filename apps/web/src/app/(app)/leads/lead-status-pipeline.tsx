'use client';

import * as React from 'react';
import { Check, Trophy, X } from 'lucide-react';
import type { LeadStatus } from '@hilatech/contracts';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Textarea,
  cn,
} from '@hilatech/ui';
import { LEAD_PIPELINE_STAGES, LEAD_STATUS_LABELS } from '@/lib/crm';

export interface LeadStatusPipelineProps {
  status: LeadStatus;
  /** Called with the new status; `lostReason` only accompanies `lost`. */
  onChange: (status: LeadStatus, lostReason?: string) => void;
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}

/**
 * Inline stage control: new → contacted → qualified → proposal, then won or lost. Clicking a stage
 * moves the lead there (forwards or back); "Lost" asks for a reason first.
 */
export function LeadStatusPipeline({
  status,
  onChange,
  disabled = false,
  pending = false,
  className,
}: LeadStatusPipelineProps) {
  const [lostOpen, setLostOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const isWon = status === 'won';
  const isLost = status === 'lost';
  const currentIndex = LEAD_PIPELINE_STAGES.indexOf(
    status as (typeof LEAD_PIPELINE_STAGES)[number],
  );
  const inactive = disabled || pending;

  const select = (next: LeadStatus) => {
    if (inactive || next === status) return;
    if (next === 'lost') {
      setReason('');
      setLostOpen(true);
      return;
    }
    onChange(next);
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between',
        className,
      )}
      aria-busy={pending || undefined}
    >
      <ol aria-label="Pipeline stage" className="flex flex-wrap items-center gap-1.5">
        {LEAD_PIPELINE_STAGES.map((stage, index) => {
          const reached = isWon || (!isLost && index <= currentIndex);
          const current = stage === status;
          return (
            <li key={stage} className="flex items-center gap-1.5">
              <button
                type="button"
                aria-current={current ? 'step' : undefined}
                aria-pressed={current}
                disabled={inactive}
                onClick={() => select(stage)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  current
                    ? 'border-accent bg-accent text-accent-fg shadow-xs'
                    : reached
                      ? 'border-accent/30 bg-accent-soft text-accent-soft-fg hover:border-accent/60'
                      : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                {reached && !current ? <Check className="size-3.5" aria-hidden /> : null}
                {LEAD_STATUS_LABELS[stage]}
              </button>
              {index < LEAD_PIPELINE_STAGES.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    'h-px w-3',
                    isWon || (!isLost && index < currentIndex)
                      ? 'bg-accent/50'
                      : 'bg-border-strong',
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={isWon ? 'primary' : 'secondary'}
          disabled={inactive}
          aria-pressed={isWon}
          leadingIcon={<Trophy aria-hidden />}
          onClick={() => select('won')}
          className={cn(
            isWon && 'bg-success hover:bg-success text-white',
            !isWon && 'text-success hover:border-success/50',
          )}
        >
          {isWon ? 'Won' : 'Mark won'}
        </Button>
        <Button
          size="sm"
          variant={isLost ? 'danger' : 'danger-outline'}
          disabled={inactive}
          aria-pressed={isLost}
          leadingIcon={<X aria-hidden />}
          onClick={() => select('lost')}
        >
          {isLost ? 'Lost' : 'Mark lost'}
        </Button>
      </div>

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent size="sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setLostOpen(false);
              onChange('lost', reason.trim() || undefined);
            }}
            className="flex flex-col"
          >
            <DialogHeader>
              <DialogTitle>Mark this lead as lost?</DialogTitle>
              <DialogDescription>
                A short reason helps the team learn what to change next time.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="pb-2">
              <FormField
                id="lost-reason"
                label="Reason"
                description="Optional, up to 500 characters."
              >
                <Textarea
                  autoFocus
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Chose a competitor, budget cut, no response…"
                />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setLostOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger">
                Mark as lost
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
