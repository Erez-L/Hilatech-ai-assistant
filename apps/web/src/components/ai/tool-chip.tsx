'use client';

import * as React from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import { Badge, JsonViewer, Spinner, cn } from '@hilatech/ui';
import { useT } from '@/i18n/provider';
import { msg, type Msg } from '@/i18n/msg';

export type ToolOutcome = 'running' | 'ok' | 'denied' | 'error';

export interface ToolChipProps {
  name: string;
  outcome: ToolOutcome;
  summary?: string | null;
  input?: Record<string, unknown> | null;
  /** Raw result payload (message content) shown in the details. */
  result?: unknown;
}

const OUTCOME_LABEL: Record<ToolOutcome, Msg> = {
  running: msg('ai.toolRunning'),
  ok: msg('ai.toolOk'),
  denied: msg('ai.toolDenied'),
  error: msg('ai.toolFailed'),
};
const OUTCOME_VARIANT = {
  running: 'info',
  ok: 'success',
  denied: 'warning',
  error: 'danger',
} as const;

/** Derives an outcome from a tool result's text: JSON `status` / `error` fields, else ok. */
export function outcomeFromResult(
  content: string | null | undefined,
  isError = false,
): ToolOutcome {
  if (isError) return 'error';
  if (!content) return 'ok';
  try {
    const parsed = JSON.parse(content) as { status?: string; error?: unknown } | null;
    const status = parsed && typeof parsed === 'object' ? parsed.status : undefined;
    if (status === 'denied' || status === 'requires_authorization' || status === 'forbidden')
      return 'denied';
    if (status === 'error' || (parsed && typeof parsed === 'object' && parsed.error))
      return 'error';
  } catch {
    // Plain-text result.
  }
  return 'ok';
}

/** Compact, collapsible chip describing one tool call: name, outcome and (expandable) details. */
export function ToolChip({ name, outcome, summary, input, result }: ToolChipProps) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const hasDetails = !!summary || (input && Object.keys(input).length > 0) || result != null;
  return (
    <div className="rounded-md border border-border bg-surface-muted/50 text-xs">
      <button
        type="button"
        aria-expanded={open}
        disabled={!hasDetails}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-default"
        aria-label={t('ai.tool', { name, value: t(OUTCOME_LABEL[outcome]) })}
      >
        <Wrench className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className="font-mono font-medium">{name}</span>
        {outcome === 'running' ? (
          <Spinner size="sm" label={t('ai.running')} />
        ) : (
          <Badge variant={OUTCOME_VARIANT[outcome]} className="px-1.5 py-0 text-[0.625rem]">
            {t(OUTCOME_LABEL[outcome])}
          </Badge>
        )}
        {summary ? (
          <span className="min-w-0 flex-1 truncate text-fg-muted">{summary}</span>
        ) : (
          <span className="flex-1" />
        )}
        {hasDetails ? (
          <ChevronRight
            className={cn('size-3.5 text-fg-subtle transition-transform', open && 'rotate-90')}
            aria-hidden
          />
        ) : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border px-2.5 py-2">
          {summary ? <p className="text-fg-muted">{summary}</p> : null}
          {input && Object.keys(input).length > 0 ? (
            <div>
              <p className="mb-1 text-2xs font-medium text-fg-subtle uppercase">
                {t('common.input')}
              </p>
              <JsonViewer value={input} allowRaw={false} maxHeight={200} />
            </div>
          ) : null}
          {result != null ? (
            <div>
              <p className="mb-1 text-2xs font-medium text-fg-subtle uppercase">{t('ai.result')}</p>
              <JsonViewer value={result} allowRaw={false} maxHeight={200} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
