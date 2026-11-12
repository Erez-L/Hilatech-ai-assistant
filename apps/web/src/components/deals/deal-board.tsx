'use client';

import * as React from 'react';
import Link from 'next/link';
import type {
  BoardColumn,
  CurrencyTotal,
  DealBoard as DealBoardData,
  DealWithRelations,
  PipelineStage,
} from '@hilatech/contracts';
import { Badge, cn } from '@hilatech/ui';
import { StageKindBadge } from './deal-badges';
import { DealCard } from './deal-card';
import { useFormat, useT } from '@/i18n/provider';

/** Per-currency totals: one line per currency, never summed across currencies. */
/** Stage columns take a tone by position so the pipeline reads as a sequence of colours. */
const COLUMN_TONES = ['blue', 'teal', 'orange', 'violet', 'pink', 'green'] as const;

export function CurrencyTotals({
  totals,
  compact = false,
  className,
  testId,
}: {
  totals: readonly CurrencyTotal[];
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const t = useT();
  const fmt = useFormat();
  if (totals.length === 0)
    return <span className={cn('text-xs text-fg-subtle', className)}>—</span>;
  return (
    <ul className={cn('flex flex-col gap-0.5', className)} data-testid={testId}>
      {totals.map((total) => (
        <li key={total.currency} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="font-semibold tabular" data-currency={total.currency}>
            {fmt.currency(total.value, total.currency, { compact })}
          </span>
          {total.weightedValue !== total.value ? (
            <span className="text-fg-muted tabular" title={t('deals.weightedValue')}>
              {t('deals.weightedShort', {
                value: fmt.currency(total.weightedValue, total.currency, { compact: true }),
              })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface DropState {
  stageId: string;
  index: number;
}

export function DealBoardView({
  board,
  canMove,
  onMove,
  listHref,
}: {
  board: DealBoardData;
  canMove: boolean;
  onMove: (deal: DealWithRelations, stage: PipelineStage, position?: number) => void;
  /** Link target for columns with more deals than the board loaded. */
  listHref: (stageId: string) => string;
}) {
  const t = useT();
  const stages = React.useMemo(() => board.columns.map((c) => c.stage), [board.columns]);
  const [dragging, setDragging] = React.useState<DealWithRelations | null>(null);
  const [drop, setDrop] = React.useState<DropState | null>(null);

  const reset = () => {
    setDragging(null);
    setDrop(null);
  };

  /** Index among the column's cards (excluding the dragged one) whose midpoint is above the pointer. */
  const indexFromPointer = (list: HTMLElement, clientY: number, dragId: string): number => {
    const cards = Array.from(
      list.querySelectorAll<HTMLElement>('[data-testid="deal-card"]'),
    ).filter((el) => el.dataset.dealId !== dragId);
    let index = 0;
    for (const el of cards) {
      const rect = el.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) index += 1;
    }
    return index;
  };

  const onDrop = (column: BoardColumn, list: HTMLElement, clientY: number) => {
    if (!dragging) return;
    const index = indexFromPointer(list, clientY, dragging.id);
    const sameStage = dragging.stageId === column.stage.id;
    const currentIndex = column.deals.findIndex((d) => d.id === dragging.id);
    reset();
    if (sameStage && currentIndex === index) return;
    onMove(dragging, column.stage, index);
  };

  return (
    <div
      className="flex items-start gap-4 overflow-x-auto pb-3 scrollbar-thin"
      role="group"
      aria-label={t('deals.dealsBoard')}
      data-testid="deal-board"
    >
      {board.columns.map((column, columnIndex) => {
        const over = drop?.stageId === column.stage.id;
        return (
          <section
            key={column.stage.id}
            aria-label={t('deals.stageColumn', { stage: column.stage.name, count: column.count })}
            data-testid="deal-column"
            data-stage-id={column.stage.id}
            data-stage-kind={column.stage.kind}
            data-tone={COLUMN_TONES[columnIndex % COLUMN_TONES.length]}
            className={cn(
              'flex w-72 shrink-0 flex-col gap-3 rounded-lg border-2 bg-tone-soft p-3 transition-colors',
              over ? 'border-tone' : 'border-transparent',
            )}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const list = e.currentTarget.querySelector('ul');
              const index = list ? indexFromPointer(list, e.clientY, dragging.id) : 0;
              if (drop?.stageId !== column.stage.id || drop.index !== index)
                setDrop({ stageId: column.stage.id, index });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const list = e.currentTarget.querySelector('ul');
              if (list) onDrop(column, list, e.clientY);
            }}
          >
            <header className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <span className="truncate" dir="auto">
                    {column.stage.name}
                  </span>
                  <StageKindBadge kind={column.stage.kind} />
                </h3>
                <Badge variant="outline" data-testid="column-count">
                  {column.count}
                </Badge>
              </div>
              <div className="flex items-start justify-between gap-3 text-xs text-fg-muted">
                <span className="tabular">
                  {t('deals.probabilityValue', { value: column.stage.probability })}
                </span>
                <CurrencyTotals
                  totals={column.totals}
                  compact
                  className="min-w-0 flex-1 items-end"
                  testId="column-totals"
                />
              </div>
            </header>
            <ul className="flex min-h-16 flex-col gap-2" aria-label={column.stage.name}>
              {column.deals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  stages={stages}
                  canMove={canMove}
                  dragging={dragging?.id === deal.id}
                  onMove={(stage) => onMove(deal, stage)}
                  onDragStart={setDragging}
                  onDragEnd={reset}
                />
              ))}
              {column.deals.length === 0 ? (
                <li className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-fg-subtle">
                  {t('deals.noDealsInStage')}
                </li>
              ) : null}
            </ul>
            {column.hasMore ? (
              <Link
                href={listHref(column.stage.id)}
                className="text-xs text-accent hover:underline"
              >
                {t('deals.moreNotShown', { count: column.count - column.deals.length })}
              </Link>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
