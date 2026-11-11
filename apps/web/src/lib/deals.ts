import {
  effectiveProbability,
  weightedValue,
  type BoardColumn,
  type CurrencyTotal,
  type DealBoard,
  type DealActivityWithActor,
  type DealStatus,
  type DealWithRelations,
  type PipelineStage,
  type StageKind,
} from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';
import { msg, type Msg } from '@/i18n/msg';
import type { T } from '@/i18n/provider';
import type { Formatter } from '@/i18n/format';
import { fullName } from '@/lib/crm';

export const STAGE_KIND_LABELS: Record<StageKind, Msg> = {
  open: msg('deals.kind.open'),
  won: msg('deals.kind.won'),
  lost: msg('deals.kind.lost'),
};

export const DEAL_STATUS_LABELS: Record<DealStatus, Msg> = {
  open: msg('deals.status.open'),
  won: msg('deals.status.won'),
  lost: msg('deals.status.lost'),
};

export const DEAL_STATUS_TONES: Record<DealStatus, StatusTone> = {
  open: 'info',
  won: 'success',
  lost: 'danger',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function addTotal(
  totals: readonly CurrencyTotal[],
  currency: string,
  sign: 1 | -1,
  value: number,
  weighted: number,
): CurrencyTotal[] {
  const next = totals.map((t) => ({ ...t }));
  let row = next.find((t) => t.currency === currency);
  if (!row) {
    if (sign < 0) return next;
    row = { currency, count: 0, value: 0, weightedValue: 0 };
    next.push(row);
  }
  row.count = Math.max(0, row.count + sign);
  row.value = round2(row.value + sign * value);
  row.weightedValue = round2(row.weightedValue + sign * weighted);
  return next
    .filter((t) => t.count > 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function weightedFor(stage: PipelineStage, value: number): number {
  return stage.kind === 'lost' ? 0 : weightedValue(value, effectiveProbability(stage.kind, stage.probability));
}

function sumTotals(columns: readonly BoardColumn[]): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>();
  for (const c of columns) {
    for (const t of c.totals) {
      const acc = map.get(t.currency) ?? { currency: t.currency, count: 0, value: 0, weightedValue: 0 };
      acc.count += t.count;
      acc.value = round2(acc.value + t.value);
      acc.weightedValue = round2(acc.weightedValue + t.weightedValue);
      map.set(t.currency, acc);
    }
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Finds the column and deal on the board. */
export function findDealOnBoard(
  board: DealBoard,
  dealId: string,
): { column: BoardColumn; deal: DealWithRelations } | null {
  for (const column of board.columns) {
    const deal = column.deals.find((d) => d.id === dealId);
    if (deal) return { column, deal };
  }
  return null;
}

/**
 * Pure optimistic update for a card move: removes the card from its column and inserts it at `position`
 * (default: bottom) of the destination, adjusting counts and the per-currency totals (never summed across
 * currencies) and the deal's own stage / status. Returns the same board when the deal is not on it.
 * The server stays the source of truth: the caller refetches after the mutation settles.
 */
export function moveDealOnBoard(
  board: DealBoard,
  dealId: string,
  toStageId: string,
  position?: number | null,
): DealBoard {
  const found = findDealOnBoard(board, dealId);
  const target = board.columns.find((c) => c.stage.id === toStageId);
  if (!found || !target) return board;
  const { column: source, deal } = found;
  const value = deal.value ?? 0;
  const sameColumn = source.stage.id === target.stage.id;

  const moved: DealWithRelations = sameColumn
    ? deal
    : {
        ...deal,
        stageId: target.stage.id,
        stage: {
          id: target.stage.id,
          name: target.stage.name,
          kind: target.stage.kind,
          probability: target.stage.probability,
          order: target.stage.order,
        },
        status: target.stage.kind,
        closedAt: target.stage.kind === 'open' ? null : new Date().toISOString(),
        stageEnteredAt: new Date().toISOString(),
      };

  const columns = board.columns.map((col): BoardColumn => {
    if (sameColumn && col.stage.id === target.stage.id) {
      const without = col.deals.filter((d) => d.id !== dealId);
      const index =
        position == null ? without.length : Math.max(0, Math.min(without.length, Math.trunc(position)));
      const deals = [...without.slice(0, index), moved, ...without.slice(index)];
      return { ...col, deals: deals.map((d, i) => ({ ...d, position: i })) };
    }
    if (col.stage.id === source.stage.id) {
      const deals = col.deals.filter((d) => d.id !== dealId).map((d, i) => ({ ...d, position: i }));
      return {
        ...col,
        deals,
        count: Math.max(0, col.count - 1),
        totals: deal.value == null ? col.totals : addTotal(col.totals, deal.currency, -1, value, weightedFor(col.stage, value)),
      };
    }
    if (col.stage.id === target.stage.id) {
      const index =
        position == null ? col.deals.length : Math.max(0, Math.min(col.deals.length, Math.trunc(position)));
      const deals = [...col.deals.slice(0, index), moved, ...col.deals.slice(index)].map((d, i) => ({
        ...d,
        position: i,
      }));
      return {
        ...col,
        deals,
        count: col.count + 1,
        totals: deal.value == null ? col.totals : addTotal(col.totals, deal.currency, 1, value, weightedFor(col.stage, value)),
      };
    }
    return col;
  });
  return { ...board, columns, totals: sumTotals(columns) };
}

/** True when moving into this stage needs the lost-reason prompt. */
export function needsLostReason(stage: Pick<PipelineStage, 'kind'>, fromKind: StageKind): boolean {
  return stage.kind === 'lost' && fromKind !== 'lost';
}

/** Drops the closed columns (won / lost) when the board hides them. */
export function visibleColumns(board: DealBoard, includeClosed: boolean): BoardColumn[] {
  return includeClosed ? board.columns : board.columns.filter((c) => c.stage.kind === 'open');
}

/** Stage options (id -> name, order) of a board's pipeline in display order. */
export function orderedStages(stages: readonly PipelineStage[]): PipelineStage[] {
  return [...stages].sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------------------
// Activity timeline
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export interface DescribedActivity {
  title: string;
  description?: string;
  tone: 'neutral' | 'success' | 'danger' | 'accent';
}

/** Human sentence for one deal activity (the payload shapes come from the move / update domain code). */
export function describeDealActivity(
  activity: DealActivityWithActor,
  t: T,
  _fmt: Pick<Formatter, 'currency'>,
): DescribedActivity {
  const p = activity.payload;
  const actor = activity.actor ? fullName(activity.actor) : t('crm.activity.system');
  switch (activity.type) {
    case 'created':
      return { title: t('deals.activity.created', { actor }), description: str(p.stage) ?? undefined, tone: 'accent' };
    case 'stage_changed':
      return {
        title: t('deals.activity.stageChanged', { actor, from: str(p.from) ?? '—', to: str(p.to) ?? '—' }),
        tone: 'neutral',
      };
    case 'reopened':
      return {
        title: t('deals.activity.reopened', { actor, to: str(p.to) ?? '—' }),
        tone: 'accent',
      };
    case 'won':
      return { title: t('deals.activity.won', { actor }), tone: 'success' };
    case 'lost':
      return {
        title: t('deals.activity.lost', { actor }),
        description: str(p.lostReason) ?? undefined,
        tone: 'danger',
      };
    case 'value_changed': {
      const to = typeof p.to === 'number' ? p.to : null;
      return {
        title: t('deals.activity.valueChanged', { actor }),
        description: to != null ? String(to) : undefined,
        tone: 'neutral',
      };
    }
    case 'owner_changed':
      return { title: t('deals.activity.ownerChanged', { actor }), tone: 'neutral' };
    case 'note_added':
      return { title: t('deals.activity.noteAdded', { actor }), tone: 'neutral' };
    default:
      return { title: t('deals.activity.updated', { actor }), tone: 'neutral' };
  }
}
