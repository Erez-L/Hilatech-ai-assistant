import { type LeadStatus, Permission } from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';

import { AppException } from '../../common/errors/app.exception';

/** Activity row to be written alongside a lead mutation. */
export interface LeadActivityDraft {
  type:
    | 'created'
    | 'status_changed'
    | 'assigned'
    | 'note_added'
    | 'contact_linked'
    | 'value_changed'
    | 'converted'
    | 'updated';
  payload: Record<string, unknown>;
}

/** The subset of a lead the rules reason about (already normalised: Decimal → number). */
export interface LeadSnapshot {
  status: LeadStatus;
  value: number | null;
  contactId: string | null;
  assigneeId: string | null;
  convertedAt: Date | null;
  lostReason: string | null;
}

/** Normalised set of changes about to be applied by PATCH (only keys that actually change). */
export interface LeadChanges {
  status?: LeadStatus;
  value?: number | null;
  contactId?: string | null;
  assigneeId?: string | null;
  lostReason?: string | null;
  /** Any other changed fields (title, description, tags, …) by name. */
  otherFields: string[];
}

export const CLOSED_LEAD_STATUSES: readonly LeadStatus[] = ['won', 'lost'];

/** Pure business rules for leads; exported for unit tests. */
export const LeadRules = {
  isClosed(status: LeadStatus): boolean {
    return CLOSED_LEAD_STATUSES.includes(status);
  },

  /**
   * Derives the activity timeline entries for an update. Each meaningful change yields its own typed
   * entry (status / value / contact / assignee); remaining edits collapse into a single `updated`
   * entry. No changes → no activities.
   */
  deriveActivities(previous: LeadSnapshot, changes: LeadChanges): LeadActivityDraft[] {
    const activities: LeadActivityDraft[] = [];
    if (changes.status !== undefined && changes.status !== previous.status) {
      activities.push({
        type: 'status_changed',
        payload: {
          from: previous.status,
          to: changes.status,
          ...(changes.status === 'lost' && (changes.lostReason ?? previous.lostReason)
            ? { lostReason: changes.lostReason ?? previous.lostReason }
            : {}),
        },
      });
    }
    if (changes.value !== undefined && changes.value !== previous.value) {
      activities.push({
        type: 'value_changed',
        payload: { from: previous.value, to: changes.value },
      });
    }
    if (changes.contactId !== undefined && changes.contactId !== previous.contactId) {
      activities.push({
        type: 'contact_linked',
        payload: { from: previous.contactId, to: changes.contactId },
      });
    }
    if (changes.assigneeId !== undefined && changes.assigneeId !== previous.assigneeId) {
      activities.push({
        type: 'assigned',
        payload: { from: previous.assigneeId, to: changes.assigneeId },
      });
    }
    const lostReasonOnly =
      changes.lostReason !== undefined &&
      changes.lostReason !== previous.lostReason &&
      !activities.some((a) => a.type === 'status_changed');
    const otherFields = [...changes.otherFields, ...(lostReasonOnly ? ['lostReason'] : [])];
    if (otherFields.length > 0 && activities.length === 0) {
      activities.push({ type: 'updated', payload: { fields: otherFields } });
    } else if (otherFields.length > 0) {
      // Typed entries already describe the change; keep the field list on the first one for completeness.
      activities[0]!.payload = { ...activities[0]!.payload, alsoChanged: otherFields };
    }
    return activities;
  },

  /** A lead can be converted exactly once. */
  assertConvertible(lead: Pick<LeadSnapshot, 'convertedAt'>): void {
    if (lead.convertedAt) {
      throw AppException.conflict('This lead has already been converted', {
        convertedAt: lead.convertedAt.toISOString(),
      });
    }
  },

  /**
   * Changing the assignee to someone else requires `leads:assign`; `leads:update` alone only allows
   * taking (or keeping) the lead yourself. Keeps `PATCH /leads/:id` from bypassing `POST /leads/:id/assign`.
   */
  assertCanSetAssignee(
    tenant: Pick<TenantContext, 'userId' | 'permissions'>,
    nextAssigneeId: string | null,
    previousAssigneeId: string | null,
  ): void {
    if (nextAssigneeId === previousAssigneeId) return;
    if (nextAssigneeId === tenant.userId) return;
    if (!tenant.permissions.includes(Permission.LEADS_ASSIGN)) {
      throw AppException.forbidden('Assigning leads to other members requires leads:assign', {
        required: [Permission.LEADS_ASSIGN],
      });
    }
  },

  /** A note may be removed by its author or by anyone allowed to delete leads. */
  assertCanDeleteNote(
    tenant: Pick<TenantContext, 'userId' | 'permissions'>,
    note: { authorId: string },
  ): void {
    if (note.authorId === tenant.userId) return;
    if (tenant.permissions.includes(Permission.LEADS_DELETE)) return;
    throw AppException.forbidden(
      'Only the author (or a member with leads:delete) can delete this note',
    );
  },
};
