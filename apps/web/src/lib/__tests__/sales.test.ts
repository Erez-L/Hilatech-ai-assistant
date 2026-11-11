import { describe, expect, it } from 'vitest';
import { makeBoard } from './fixtures';
import { moveDealOnBoard, needsLostReason, visibleColumns } from '@/lib/deals';
import {
  DEFAULT_TASK_FILTERS,
  dueRange,
  hasActiveTaskFilters,
  taskFiltersToQuery,
} from '@/lib/tasks';
import {
  canValidate,
  initialWizardState,
  mappedColumnCount,
  missingRequiredFields,
  wizardReducer,
  type WizardState,
} from '@/lib/imports';

describe('moveDealOnBoard (optimistic update)', () => {
  it('moves the card, recomputes counts and keeps totals per currency', () => {
    const next = moveDealOnBoard(makeBoard(), 'a', 's2');
    const [c1, c2] = next.columns;
    expect(c1!.deals.map((d) => d.id)).toEqual(['b', 'c']);
    expect(c1!.count).toBe(2);
    expect(c1!.totals).toEqual([{ currency: 'ILS', count: 1, value: 500, weightedValue: 100 }]);
    expect(c2!.deals.map((d) => d.id)).toEqual(['a']);
    expect(c2!.deals[0]!.stageId).toBe('s2');
    expect(c2!.deals[0]!.stage.name).toBe('S2');
    expect(c2!.totals).toEqual([{ currency: 'USD', count: 1, value: 1000, weightedValue: 500 }]);
    // never summed across currencies
    expect(next.totals.map((t) => t.currency)).toEqual(['ILS', 'USD']);
  });

  it('does not mutate the input board (so a snapshot can be restored)', () => {
    const board = makeBoard();
    const before = JSON.stringify(board);
    moveDealOnBoard(board, 'a', 's2');
    expect(JSON.stringify(board)).toBe(before);
  });

  it('closes the deal as lost with zero weighted value when moved to a lost stage', () => {
    const next = moveDealOnBoard(makeBoard(), 'a', 's3');
    const moved = next.columns[2]!.deals[0]!;
    expect(moved.status).toBe('lost');
    expect(moved.closedAt).not.toBeNull();
    expect(next.columns[2]!.totals).toEqual([
      { currency: 'USD', count: 1, value: 1000, weightedValue: 0 },
    ]);
  });

  it('reorders inside the same column at a position', () => {
    const next = moveDealOnBoard(makeBoard(), 'c', 's1', 0);
    expect(next.columns[0]!.deals.map((d) => [d.id, d.position])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ]);
    expect(next.columns[0]!.count).toBe(3);
  });

  it('moves a deal without a value without touching totals', () => {
    const next = moveDealOnBoard(makeBoard(), 'c', 's2');
    expect(next.columns[1]!.count).toBe(1);
    expect(next.columns[1]!.totals).toEqual([]);
    expect(next.columns[0]!.totals).toHaveLength(2);
  });

  it('returns the same board for unknown deals or stages', () => {
    const board = makeBoard();
    expect(moveDealOnBoard(board, 'zzz', 's2')).toBe(board);
    expect(moveDealOnBoard(board, 'a', 'zzz')).toBe(board);
  });

  it('asks for a lost reason only when entering a lost stage', () => {
    expect(needsLostReason({ kind: 'lost' }, 'open')).toBe(true);
    expect(needsLostReason({ kind: 'lost' }, 'lost')).toBe(false);
    expect(needsLostReason({ kind: 'won' }, 'open')).toBe(false);
  });

  it('hides closed columns unless asked', () => {
    const board = makeBoard();
    expect(visibleColumns(board, false).map((c) => c.stage.id)).toEqual(['s1', 's2']);
    expect(visibleColumns(board, true)).toHaveLength(3);
  });
});

describe('task filters', () => {
  const now = new Date(2026, 4, 10, 15, 30);

  it('maps the default (open) filters to the open statuses', () => {
    const q = taskFiltersToQuery(DEFAULT_TASK_FILTERS, now);
    expect(q.status).toEqual(['todo', 'in_progress']);
    expect(q.assigneeId).toBeUndefined();
    expect(q.unassigned).toBeUndefined();
    expect(hasActiveTaskFilters(DEFAULT_TASK_FILTERS)).toBe(false);
  });

  it('supports "me", unassigned, specific users, overdue and related records', () => {
    expect(taskFiltersToQuery({ ...DEFAULT_TASK_FILTERS, assignee: 'me' }, now).assigneeId).toBe(
      'me',
    );
    const un = taskFiltersToQuery({ ...DEFAULT_TASK_FILTERS, assignee: 'unassigned' }, now);
    expect(un.unassigned).toBe(true);
    expect(un.assigneeId).toBeUndefined();
    const q = taskFiltersToQuery(
      { ...DEFAULT_TASK_FILTERS, status: 'all', overdue: true, dealId: 'd1', search: '  call ' },
      now,
    );
    expect(q.status).toBeUndefined();
    expect(q.overdue).toBe(true);
    expect(q.dealId).toBe('d1');
    expect(q.search).toBe('call');
    expect(hasActiveTaskFilters({ ...DEFAULT_TASK_FILTERS, overdue: true })).toBe(true);
  });

  it('computes local-day due ranges', () => {
    const today = dueRange({ due: 'today', dueFrom: '', dueTo: '' }, now);
    expect(new Date(today.dueFrom!).getTime()).toBe(new Date(2026, 4, 10).getTime());
    expect(new Date(today.dueTo!).getTime()).toBe(new Date(2026, 4, 11).getTime());
    const week = dueRange({ due: 'next7', dueFrom: '', dueTo: '' }, now);
    expect(new Date(week.dueTo!).getTime()).toBe(new Date(2026, 4, 18).getTime());
    const custom = dueRange({ due: 'custom', dueFrom: '2026-05-01', dueTo: '2026-05-03' }, now);
    expect(new Date(custom.dueFrom!).getTime()).toBe(new Date(2026, 4, 1).getTime());
    expect(new Date(custom.dueTo!).getTime()).toBe(new Date(2026, 4, 4).getTime());
    expect(dueRange({ due: 'any', dueFrom: '', dueTo: '' }, now)).toEqual({});
  });
});

describe('import wizard reducer', () => {
  const upload = {
    id: 'j1',
    entity: 'contacts',
    status: 'uploaded',
    headers: ['שם פרטי', 'שם משפחה', 'אימייל'],
    suggestedMapping: { firstName: 0, lastName: 1, email: 2 },
    totalRows: 3,
    fields: [],
    validation: null,
  } as never;

  const after = (state: WizardState, ...actions: Parameters<typeof wizardReducer>[1][]) =>
    actions.reduce(wizardReducer, state);

  it('starts on upload and moves to mapping with the suggested mapping', () => {
    const s = after(initialWizardState(), { type: 'uploaded', upload });
    expect(s.step).toBe('mapping');
    expect(s.mapping).toEqual({ firstName: 0, lastName: 1, email: 2 });
    expect(canValidate(s)).toBe(true);
    expect(mappedColumnCount(s.mapping)).toBe(3);
  });

  it('lets a column feed only one field', () => {
    const s = after(
      initialWizardState(),
      { type: 'uploaded', upload },
      { type: 'map', field: 'phone', column: 2 },
    );
    expect(s.mapping.phone).toBe(2);
    expect(s.mapping.email).toBeNull();
    expect(s.stale).toBe(true);
  });

  it('reports missing required fields and blocks validation', () => {
    const s = after(
      initialWizardState(),
      { type: 'uploaded', upload },
      { type: 'map', field: 'firstName', column: null },
    );
    expect(missingRequiredFields('contacts', s.mapping, 3)).toEqual(['firstName']);
    expect(canValidate(s)).toBe(false);
  });

  it('resets to the suggested mapping', () => {
    const s = after(
      initialWizardState(),
      { type: 'uploaded', upload },
      { type: 'map', field: 'email', column: null },
      { type: 'resetMapping' },
    );
    expect(s.mapping.email).toBe(2);
  });

  it('goes review -> progress -> result and back', () => {
    const job = (status: string) =>
      ({ ...(upload as object), status, validation: { total: 3 } }) as never;
    let s = after(
      initialWizardState(),
      { type: 'uploaded', upload },
      { type: 'validated', job: job('validated') },
    );
    expect(s.step).toBe('review');
    expect(s.stale).toBe(false);
    s = wizardReducer(s, { type: 'strategy', strategy: 'update' });
    expect(s.stale).toBe(true);
    expect(wizardReducer(s, { type: 'back' }).step).toBe('mapping');
    s = after(s, { type: 'started', job: job('queued') });
    expect(s.step).toBe('progress');
    s = wizardReducer(s, { type: 'progress', job: job('running') });
    expect(s.step).toBe('progress');
    s = wizardReducer(s, { type: 'progress', job: job('completed') });
    expect(s.step).toBe('result');
    expect(wizardReducer(s, { type: 'restart' }).step).toBe('upload');
  });

  it('only changes the entity on the upload step', () => {
    const s = after(initialWizardState(), { type: 'entity', entity: 'deals' });
    expect(s.entity).toBe('deals');
    const m = after(s, { type: 'uploaded', upload });
    expect(wizardReducer(m, { type: 'entity', entity: 'leads' }).entity).toBe('contacts');
  });
});
