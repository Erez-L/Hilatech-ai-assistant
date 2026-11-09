import {
  ALL_PERMISSIONS,
  ErrorCode,
  Permission,
  SYSTEM_ROLE_PERMISSIONS,
} from '@hilatech/contracts';

import { type AppException } from '../../common/errors/app.exception';
import { LeadRules, type LeadSnapshot } from './lead.rules';

const base: LeadSnapshot = {
  status: 'new',
  value: 100,
  contactId: null,
  assigneeId: null,
  convertedAt: null,
  lostReason: null,
};

function capture(fn: () => void): AppException | undefined {
  try {
    fn();
  } catch (e) {
    return e as AppException;
  }
  return undefined;
}

describe('LeadRules.deriveActivities', () => {
  it('returns nothing when nothing changed', () => {
    expect(LeadRules.deriveActivities(base, { otherFields: [] })).toEqual([]);
  });

  it('records a status change with the lost reason when the lead is lost', () => {
    const result = LeadRules.deriveActivities(base, {
      status: 'lost',
      lostReason: 'Budget',
      otherFields: [],
    });
    expect(result).toEqual([
      { type: 'status_changed', payload: { from: 'new', to: 'lost', lostReason: 'Budget' } },
    ]);
  });

  it('does not attach lostReason to non-lost transitions', () => {
    const result = LeadRules.deriveActivities(base, { status: 'qualified', otherFields: [] });
    expect(result).toEqual([{ type: 'status_changed', payload: { from: 'new', to: 'qualified' } }]);
  });

  it('records value, contact and assignee changes as separate typed entries', () => {
    const result = LeadRules.deriveActivities(base, {
      value: 250,
      contactId: 'c1',
      assigneeId: 'u2',
      otherFields: [],
    });
    expect(result.map((a) => a.type)).toEqual(['value_changed', 'contact_linked', 'assigned']);
    expect(result[0]!.payload).toEqual({ from: 100, to: 250 });
    expect(result[1]!.payload).toEqual({ from: null, to: 'c1' });
    expect(result[2]!.payload).toEqual({ from: null, to: 'u2' });
  });

  it('collapses other edits into a single "updated" entry', () => {
    const result = LeadRules.deriveActivities(base, { otherFields: ['title', 'tags'] });
    expect(result).toEqual([{ type: 'updated', payload: { fields: ['title', 'tags'] } }]);
  });

  it('attaches other edits to the first typed entry instead of adding "updated"', () => {
    const result = LeadRules.deriveActivities(base, {
      status: 'contacted',
      otherFields: ['description'],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'status_changed',
      payload: { from: 'new', to: 'contacted', alsoChanged: ['description'] },
    });
  });

  it('treats a lostReason edit without a status change as a plain update', () => {
    const result = LeadRules.deriveActivities(
      { ...base, status: 'lost' },
      { lostReason: 'Went with competitor', otherFields: [] },
    );
    expect(result).toEqual([{ type: 'updated', payload: { fields: ['lostReason'] } }]);
  });

  it('ignores "changes" equal to the current values', () => {
    const result = LeadRules.deriveActivities(base, {
      status: 'new',
      value: 100,
      otherFields: [],
    });
    expect(result).toEqual([]);
  });
});

describe('LeadRules.assertConvertible', () => {
  it('allows converting an unconverted lead and rejects a second conversion with 409', () => {
    expect(() => LeadRules.assertConvertible({ convertedAt: null })).not.toThrow();
    const error = capture(() =>
      LeadRules.assertConvertible({ convertedAt: new Date('2026-01-01T00:00:00Z') }),
    );
    expect(error?.code).toBe(ErrorCode.CONFLICT);
    expect(error?.getStatus()).toBe(409);
  });
});

describe('LeadRules.assertCanSetAssignee', () => {
  const member = { userId: 'me', permissions: SYSTEM_ROLE_PERMISSIONS.member };
  const admin = { userId: 'me', permissions: ALL_PERMISSIONS };

  it('lets anyone with leads:update take a lead themselves or leave the assignee unchanged', () => {
    expect(() => LeadRules.assertCanSetAssignee(member, 'me', null)).not.toThrow();
    expect(() => LeadRules.assertCanSetAssignee(member, 'other', 'other')).not.toThrow();
  });

  it('requires leads:assign to hand a lead to someone else (or unassign)', () => {
    const error = capture(() => LeadRules.assertCanSetAssignee(member, 'other', null));
    expect(error?.code).toBe(ErrorCode.FORBIDDEN);
    expect(error?.details).toEqual({ required: [Permission.LEADS_ASSIGN] });
    expect(() => LeadRules.assertCanSetAssignee(member, null, 'other')).toThrow();
    expect(() => LeadRules.assertCanSetAssignee(admin, 'other', null)).not.toThrow();
    expect(() => LeadRules.assertCanSetAssignee(admin, null, 'other')).not.toThrow();
  });
});

describe('LeadRules.assertCanDeleteNote', () => {
  it('allows the author, anyone with leads:delete, and nobody else', () => {
    const author = { userId: 'a', permissions: SYSTEM_ROLE_PERMISSIONS.member };
    const other = { userId: 'b', permissions: SYSTEM_ROLE_PERMISSIONS.member };
    const admin = { userId: 'c', permissions: ALL_PERMISSIONS };
    expect(() => LeadRules.assertCanDeleteNote(author, { authorId: 'a' })).not.toThrow();
    expect(() => LeadRules.assertCanDeleteNote(admin, { authorId: 'a' })).not.toThrow();
    expect(capture(() => LeadRules.assertCanDeleteNote(other, { authorId: 'a' }))?.code).toBe(
      ErrorCode.FORBIDDEN,
    );
  });
});
