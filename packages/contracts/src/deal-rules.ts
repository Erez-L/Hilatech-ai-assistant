/**
 * Pure pipeline / Kanban logic shared by the API, the workers, the AI tools and the web app:
 * stage ordering, card positions inside a column, stage-set validation and stage-conversion maths.
 * No I/O, no framework imports.
 */

export type StageKindValue = 'open' | 'won' | 'lost';
export type DealStatusValue = 'open' | 'won' | 'lost';

export interface DefaultStageSpec {
  name: string;
  probability: number;
  kind: StageKindValue;
}

export const DEFAULT_PIPELINE_NAME = 'Sales';
export const DEFAULT_STAGES: readonly DefaultStageSpec[] = [
  { name: 'Lead', probability: 10, kind: 'open' },
  { name: 'Qualified', probability: 25, kind: 'open' },
  { name: 'Proposal', probability: 50, kind: 'open' },
  { name: 'Negotiation', probability: 75, kind: 'open' },
  { name: 'Won', probability: 100, kind: 'won' },
  { name: 'Lost', probability: 0, kind: 'lost' },
];

/** A deal's status follows the kind of the stage it sits in. */
export function statusForKind(kind: StageKindValue): DealStatusValue {
  return kind;
}

export function isClosedKind(kind: StageKindValue): boolean {
  return kind !== 'open';
}

/** Probability is forced by the kind for closed stages (won = 100, lost = 0). */
export function effectiveProbability(kind: StageKindValue, probability: number): number {
  if (kind === 'won') return 100;
  if (kind === 'lost') return 0;
  return Math.max(0, Math.min(100, Math.round(probability)));
}

/**
 * Inserts `id` into `ids` at `position` (0-based, clamped; undefined or null = append). If `id` is already in the
 * list it is moved. Returns a new array.
 */
export function insertAt<T>(ids: readonly T[], id: T, position?: number | null): T[] {
  const without = ids.filter((x) => x !== id);
  const index =
    position === undefined || position === null
      ? without.length
      : Math.max(0, Math.min(without.length, Math.trunc(position)));
  return [...without.slice(0, index), id, ...without.slice(index)];
}

export interface PositionUpdate {
  id: string;
  position: number;
}

/** Contiguous 0..n-1 positions for an ordered list of ids. */
export function resequence(ids: readonly string[]): PositionUpdate[] {
  return ids.map((id, position) => ({ id, position }));
}

export interface DealMovePlan {
  /** Final order of the destination column (contains the moved deal). */
  targetOrder: string[];
  /** Final order of the source column after the deal left it; empty when the deal stays in its column. */
  sourceOrder: string[];
  /** True when the stage changed. */
  stageChanged: boolean;
  /** Position updates to persist: destination column, then source column. */
  updates: PositionUpdate[];
}

/**
 * Plans a card move on the board. `targetColumn` / `sourceColumn` are the deal ids currently in each column in
 * display order (the source column is ignored when the stage does not change; the moved deal may appear in either).
 */
export function planDealMove(input: {
  dealId: string;
  fromStageId: string;
  toStageId: string;
  targetColumn: readonly string[];
  sourceColumn: readonly string[];
  position?: number | null;
}): DealMovePlan {
  const stageChanged = input.fromStageId !== input.toStageId;
  const targetOrder = insertAt(input.targetColumn, input.dealId, input.position);
  const sourceOrder = stageChanged ? input.sourceColumn.filter((id) => id !== input.dealId) : [];
  return {
    targetOrder,
    sourceOrder,
    stageChanged,
    updates: [...resequence(targetOrder), ...resequence(sourceOrder)],
  };
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/** A pipeline must keep at least one open, one won and one lost stage so deals can always be opened and closed. */
export function validateStageSet(stages: ReadonlyArray<{ kind: StageKindValue }>): string | null {
  if (!stages.some((s) => s.kind === 'open')) return 'A pipeline needs at least one open stage';
  if (!stages.some((s) => s.kind === 'won')) return 'A pipeline needs at least one won stage';
  if (!stages.some((s) => s.kind === 'lost')) return 'A pipeline needs at least one lost stage';
  return null;
}

/** `requested` must be a permutation of `current` (same ids, no duplicates). Returns an error message or null. */
export function validateStageReorder(
  current: readonly string[],
  requested: readonly string[],
): string | null {
  if (new Set(requested).size !== requested.length) return 'Stage ids must be unique';
  if (requested.length !== current.length) return 'All stages of the pipeline must be listed';
  const known = new Set(current);
  if (requested.some((id) => !known.has(id))) return 'Unknown stage id in the list';
  return null;
}

/** Contiguous 0..n-1 order for stages listed in display order. */
export function stageOrders(ids: readonly string[]): PositionUpdate[] {
  return resequence(ids);
}

/**
 * Inserts a new stage id at `order` among the existing ids (sorted by current order). `order` undefined = just before
 * the first closed stage, so new open stages stay left of Won / Lost.
 */
export function stageOrderAfterInsert(
  existing: ReadonlyArray<{ id: string; kind: StageKindValue }>,
  newId: string,
  newKind: StageKindValue,
  order?: number,
): string[] {
  const ids = existing.map((s) => s.id);
  if (order !== undefined) return insertAt(ids, newId, order);
  if (newKind !== 'open') return [...ids, newId];
  const firstClosed = existing.findIndex((s) => s.kind !== 'open');
  return insertAt(ids, newId, firstClosed === -1 ? undefined : firstClosed);
}

// ---------------------------------------------------------------------------
// Stage conversion
// ---------------------------------------------------------------------------

export interface ConversionStage {
  id: string;
  name: string;
  order: number;
  kind: StageKindValue;
}

/** Deals grouped by the highest open-stage order they ever reached (-1 = none) and their current status. */
export interface ReachRow {
  maxOrder: number;
  status: DealStatusValue;
  n: number;
}

export interface StageConversionRow {
  stageId: string;
  name: string;
  order: number;
  /** Deals that entered this stage or any later open stage (or were won). */
  reached: number;
  rateFromPrevious: number | null;
  rateFromTop: number | null;
}

const rate = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((num / den) * 1000) / 1000;

/**
 * Funnel over the OPEN stages of a pipeline: a deal "reached" stage S when it entered S or a later open stage, or
 * when it was won (a won deal necessarily passed through the pipeline). Lost deals only count up to the furthest
 * open stage they reached.
 */
export function stageConversion(
  stages: readonly ConversionStage[],
  rows: readonly ReachRow[],
): StageConversionRow[] {
  const open = [...stages].filter((s) => s.kind === 'open').sort((a, b) => a.order - b.order);
  const out: StageConversionRow[] = [];
  let previous: number | null = null;
  let top: number | null = null;
  for (const stage of open) {
    const reached = rows.reduce(
      (sum, r) => sum + (r.status === 'won' || r.maxOrder >= stage.order ? r.n : 0),
      0,
    );
    if (top === null) top = reached;
    out.push({
      stageId: stage.id,
      name: stage.name,
      order: stage.order,
      reached,
      rateFromPrevious: previous === null ? null : rate(reached, previous),
      rateFromTop: rate(reached, top),
    });
    previous = reached;
  }
  return out;
}

/** won / (won + lost); null when nothing closed. */
export function winRate(won: number, lost: number): number | null {
  return rate(won, won + lost);
}

/** Weighted value of an open deal: value × stage probability. */
export function weightedValue(value: number, probability: number): number {
  return Math.round(value * probability) / 100;
}
