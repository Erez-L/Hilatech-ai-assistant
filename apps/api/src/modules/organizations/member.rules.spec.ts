import { ErrorCode } from '@hilatech/contracts';

import { MemberRules } from './member.rules';

const base = {
  actorIsOwner: true,
  targetIsActiveOwner: false,
  otherActiveOwners: 0,
  isSelf: false,
};

describe('MemberRules', () => {
  it('only owners can assign or remove the owner role', () => {
    expect(() => MemberRules.assertCanAssignRole({ ...base, actorIsOwner: false }, true)).toThrow(
      expect.objectContaining({ code: ErrorCode.FORBIDDEN }),
    );
    expect(() =>
      MemberRules.assertCanAssignRole(
        { ...base, actorIsOwner: false, targetIsActiveOwner: true, otherActiveOwners: 1 },
        false,
      ),
    ).toThrow(expect.objectContaining({ code: ErrorCode.FORBIDDEN }));
    expect(() =>
      MemberRules.assertCanAssignRole({ ...base, actorIsOwner: false }, false),
    ).not.toThrow();
  });

  it('cannot demote, suspend or remove the last owner', () => {
    const lastOwner = { ...base, targetIsActiveOwner: true, otherActiveOwners: 0 };
    expect(() => MemberRules.assertCanAssignRole(lastOwner, false)).toThrow(
      expect.objectContaining({ code: ErrorCode.CONFLICT }),
    );
    expect(() => MemberRules.assertCanChangeStatus(lastOwner, 'suspended')).toThrow(
      expect.objectContaining({ code: ErrorCode.CONFLICT }),
    );
    expect(() => MemberRules.assertCanRemove(lastOwner)).toThrow(
      expect.objectContaining({ code: ErrorCode.CONFLICT }),
    );
    expect(() => MemberRules.assertCanLeave(lastOwner)).toThrow(
      expect.objectContaining({ code: ErrorCode.CONFLICT }),
    );
  });

  it('allows the same operations when another active owner exists', () => {
    const notLast = { ...base, targetIsActiveOwner: true, otherActiveOwners: 1 };
    expect(() => MemberRules.assertCanAssignRole(notLast, false)).not.toThrow();
    expect(() => MemberRules.assertCanChangeStatus(notLast, 'suspended')).not.toThrow();
    expect(() => MemberRules.assertCanRemove(notLast)).not.toThrow();
    expect(() => MemberRules.assertCanLeave(notLast)).not.toThrow();
  });

  it('prevents self status changes and self removal through the admin route', () => {
    expect(() => MemberRules.assertCanChangeStatus({ ...base, isSelf: true }, 'suspended')).toThrow(
      expect.objectContaining({ code: ErrorCode.FORBIDDEN }),
    );
    expect(() => MemberRules.assertCanRemove({ ...base, isSelf: true })).toThrow(
      expect.objectContaining({ code: ErrorCode.FORBIDDEN }),
    );
  });
});
