import { SystemRole } from '@hilatech/contracts';

import { AppException } from '../../common/errors/app.exception';

export interface MemberRuleContext {
  /** Does the acting member hold the owner role? */
  actorIsOwner: boolean;
  /** Does the target member currently hold the owner role (and is active)? */
  targetIsActiveOwner: boolean;
  /** Number of OTHER active owners in the organization (excluding the target). */
  otherActiveOwners: number;
  /** Is the target the acting member themself? */
  isSelf: boolean;
}

/** Pure membership invariants (security-model.md): only owners manage owners; the last owner is protected. */
export const MemberRules = {
  isOwnerKey(key: string): boolean {
    return key === SystemRole.OWNER;
  },

  assertCanAssignRole(ctx: MemberRuleContext, newRoleIsOwner: boolean): void {
    if ((ctx.targetIsActiveOwner || newRoleIsOwner) && !ctx.actorIsOwner) {
      throw AppException.forbidden('Only an owner can assign or remove the owner role');
    }
    if (ctx.targetIsActiveOwner && !newRoleIsOwner && ctx.otherActiveOwners === 0) {
      throw AppException.conflict('Cannot demote the last owner of the organization');
    }
  },

  assertCanChangeStatus(ctx: MemberRuleContext, nextStatus: 'active' | 'suspended'): void {
    if (ctx.isSelf) throw AppException.forbidden('You cannot change your own membership status');
    if (ctx.targetIsActiveOwner && !ctx.actorIsOwner) {
      throw AppException.forbidden('Only an owner can change the status of an owner');
    }
    if (ctx.targetIsActiveOwner && nextStatus === 'suspended' && ctx.otherActiveOwners === 0) {
      throw AppException.conflict('Cannot suspend the last owner of the organization');
    }
  },

  assertCanRemove(ctx: MemberRuleContext): void {
    if (ctx.isSelf)
      throw AppException.forbidden('Use DELETE /members/me to leave the organization');
    if (ctx.targetIsActiveOwner && !ctx.actorIsOwner) {
      throw AppException.forbidden('Only an owner can remove an owner');
    }
    if (ctx.targetIsActiveOwner && ctx.otherActiveOwners === 0) {
      throw AppException.conflict('Cannot remove the last owner of the organization');
    }
  },

  assertCanLeave(ctx: Pick<MemberRuleContext, 'targetIsActiveOwner' | 'otherActiveOwners'>): void {
    if (ctx.targetIsActiveOwner && ctx.otherActiveOwners === 0) {
      throw AppException.conflict('You are the last owner; transfer ownership before leaving');
    }
  },
};

/**
 * No privilege escalation through delegated administration: a member can only hand out, create or manage roles
 * whose permissions they hold themselves. (Owners hold every permission, so they are never restricted.)
 */
export const PrivilegeRules = {
  excess(actorPermissions: readonly string[], rolePermissions: readonly string[]): string[] {
    const held = new Set(actorPermissions);
    return [...new Set(rolePermissions)].filter((p) => !held.has(p));
  },

  assertNoEscalation(
    actorPermissions: readonly string[],
    rolePermissions: readonly string[],
    what: string,
  ): void {
    const excess = PrivilegeRules.excess(actorPermissions, rolePermissions);
    if (excess.length > 0) {
      throw AppException.forbidden(
        `You cannot ${what} a role with permissions you do not hold yourself`,
        { permissions: excess },
      );
    }
  },
};
