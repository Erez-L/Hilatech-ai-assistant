import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAGES,
  effectiveProbability,
  insertAt,
  planDealMove,
  resequence,
  stageConversion,
  stageOrderAfterInsert,
  validateStageReorder,
  validateStageSet,
  weightedValue,
  winRate,
} from '../deal-rules';

describe('insertAt', () => {
  it('appends without a position', () => {
    expect(insertAt(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(insertAt(['a', 'b'], 'c', null)).toEqual(['a', 'b', 'c']);
  });
  it('inserts at an index and clamps out-of-range positions', () => {
    expect(insertAt(['a', 'b'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(insertAt(['a', 'b'], 'c', 1)).toEqual(['a', 'c', 'b']);
    expect(insertAt(['a', 'b'], 'c', 99)).toEqual(['a', 'b', 'c']);
    expect(insertAt(['a', 'b'], 'c', -5)).toEqual(['c', 'a', 'b']);
  });
  it('moves an id already in the list without duplicating it', () => {
    expect(insertAt(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(insertAt(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
  });
});

describe('planDealMove', () => {
  it('reorders inside a column and leaves the source untouched', () => {
    const plan = planDealMove({
      dealId: 'd1',
      fromStageId: 's1',
      toStageId: 's1',
      targetColumn: ['d1', 'd2', 'd3'],
      sourceColumn: ['d1', 'd2', 'd3'],
      position: 2,
    });
    expect(plan.stageChanged).toBe(false);
    expect(plan.targetOrder).toEqual(['d2', 'd3', 'd1']);
    expect(plan.sourceOrder).toEqual([]);
    expect(plan.updates).toEqual(resequence(['d2', 'd3', 'd1']));
  });
  it('moves across columns keeping both columns contiguous', () => {
    const plan = planDealMove({
      dealId: 'd1',
      fromStageId: 's1',
      toStageId: 's2',
      targetColumn: ['x', 'y'],
      sourceColumn: ['a', 'd1', 'b'],
      position: 1,
    });
    expect(plan.stageChanged).toBe(true);
    expect(plan.targetOrder).toEqual(['x', 'd1', 'y']);
    expect(plan.sourceOrder).toEqual(['a', 'b']);
    expect(plan.updates).toEqual([
      { id: 'x', position: 0 },
      { id: 'd1', position: 1 },
      { id: 'y', position: 2 },
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
    ]);
  });
  it('drops to the bottom of the destination when no position is given', () => {
    const plan = planDealMove({
      dealId: 'd1',
      fromStageId: 's1',
      toStageId: 's2',
      targetColumn: ['x'],
      sourceColumn: ['d1'],
    });
    expect(plan.targetOrder).toEqual(['x', 'd1']);
    expect(plan.sourceOrder).toEqual([]);
  });
});

describe('stage validation', () => {
  it('requires one open, one won and one lost stage', () => {
    expect(validateStageSet(DEFAULT_STAGES)).toBeNull();
    expect(validateStageSet([{ kind: 'won' }, { kind: 'lost' }])).toMatch(/open/);
    expect(validateStageSet([{ kind: 'open' }, { kind: 'lost' }])).toMatch(/won/);
    expect(validateStageSet([{ kind: 'open' }, { kind: 'won' }])).toMatch(/lost/);
  });
  it('accepts only permutations when reordering', () => {
    expect(validateStageReorder(['a', 'b', 'c'], ['c', 'a', 'b'])).toBeNull();
    expect(validateStageReorder(['a', 'b', 'c'], ['a', 'b'])).toMatch(/All stages/);
    expect(validateStageReorder(['a', 'b'], ['a', 'a'])).toMatch(/unique/);
    expect(validateStageReorder(['a', 'b'], ['a', 'z'])).toMatch(/Unknown/);
  });
  it('inserts a new open stage before the first closed stage by default', () => {
    const existing = [
      { id: 'o1', kind: 'open' as const },
      { id: 'o2', kind: 'open' as const },
      { id: 'w', kind: 'won' as const },
      { id: 'l', kind: 'lost' as const },
    ];
    expect(stageOrderAfterInsert(existing, 'n', 'open')).toEqual(['o1', 'o2', 'n', 'w', 'l']);
    expect(stageOrderAfterInsert(existing, 'n', 'won')).toEqual(['o1', 'o2', 'w', 'l', 'n']);
    expect(stageOrderAfterInsert(existing, 'n', 'open', 0)).toEqual(['n', 'o1', 'o2', 'w', 'l']);
  });
});

describe('probability and money', () => {
  it('forces probability by kind', () => {
    expect(effectiveProbability('won', 10)).toBe(100);
    expect(effectiveProbability('lost', 90)).toBe(0);
    expect(effectiveProbability('open', 140)).toBe(100);
    expect(effectiveProbability('open', 33.4)).toBe(33);
  });
  it('weights values and computes win rate', () => {
    expect(weightedValue(1000, 25)).toBe(250);
    expect(weightedValue(99.99, 50)).toBe(50);
    expect(winRate(3, 1)).toBe(0.75);
    expect(winRate(0, 0)).toBeNull();
  });
});

describe('stageConversion', () => {
  const stages = [
    { id: 's0', name: 'Lead', order: 0, kind: 'open' as const },
    { id: 's1', name: 'Qualified', order: 1, kind: 'open' as const },
    { id: 's2', name: 'Proposal', order: 2, kind: 'open' as const },
    { id: 's3', name: 'Won', order: 3, kind: 'won' as const },
    { id: 's4', name: 'Lost', order: 4, kind: 'lost' as const },
  ];
  it('counts deals that reached each open stage (won deals passed all of them)', () => {
    const rows = [
      { maxOrder: 0, status: 'lost' as const, n: 4 },
      { maxOrder: 1, status: 'open' as const, n: 3 },
      { maxOrder: 2, status: 'open' as const, n: 2 },
      { maxOrder: 2, status: 'won' as const, n: 1 },
    ];
    const out = stageConversion(stages, rows);
    expect(out.map((s) => s.reached)).toEqual([10, 6, 3]);
    expect(out[0]).toMatchObject({ rateFromPrevious: null, rateFromTop: 1 });
    expect(out[1]).toMatchObject({ rateFromPrevious: 0.6, rateFromTop: 0.6 });
    expect(out[2]).toMatchObject({ rateFromPrevious: 0.5, rateFromTop: 0.3 });
  });
  it('returns null rates for an empty funnel', () => {
    const out = stageConversion(stages, []);
    expect(out.every((s) => s.reached === 0 && s.rateFromTop === null)).toBe(true);
  });
});
