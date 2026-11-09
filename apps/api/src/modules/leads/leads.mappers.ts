import {
  type Lead as LeadDto,
  LeadActivityType,
  type LeadActivityWithActor,
  type LeadNoteWithAuthor,
  type LeadWithRelations,
} from '@hilatech/contracts';
import { type Lead, type LeadActivity, type LeadNote, type Prisma } from '@hilatech/database';

import {
  CONTACT_SUMMARY_SELECT,
  type ContactSummaryRow,
  USER_SUMMARY_SELECT,
  type UserSummaryRow,
  decimalToNumber,
  isoOrNull,
  jsonObject,
  toContactSummary,
  toUserSummary,
} from '../crm/crm.mappers';

export const LEAD_INCLUDE = {
  contact: { select: CONTACT_SUMMARY_SELECT },
  assignee: { select: USER_SUMMARY_SELECT },
} as const satisfies Prisma.LeadInclude;

export type LeadRow = Lead & {
  contact: ContactSummaryRow | null;
  assignee: UserSummaryRow | null;
};

export function toLead(row: Lead): LeadDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    status: row.status,
    source: row.source,
    value: decimalToNumber(row.value),
    currency: row.currency,
    contactId: row.contactId,
    assigneeId: row.assigneeId,
    description: row.description,
    tags: row.tags,
    customFields: jsonObject(row.customFields),
    expectedCloseDate: isoOrNull(row.expectedCloseDate),
    convertedAt: isoOrNull(row.convertedAt),
    lostReason: row.lostReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toLeadWithRelations(row: LeadRow): LeadWithRelations {
  return {
    ...toLead(row),
    contact: toContactSummary(row.contact),
    assignee: toUserSummary(row.assignee),
  };
}

export const LEAD_NOTE_INCLUDE = {
  author: { select: USER_SUMMARY_SELECT },
} as const satisfies Prisma.LeadNoteInclude;

export type LeadNoteRow = LeadNote & { author: UserSummaryRow | null };

export function toLeadNote(row: LeadNoteRow): LeadNoteWithAuthor {
  return {
    id: row.id,
    leadId: row.leadId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: toUserSummary(row.author),
  };
}

/** `LeadActivity.actorId` has no relation in the schema; actors are resolved in bulk by the service. */
export function toLeadActivity(
  row: LeadActivity,
  actor: UserSummaryRow | null | undefined,
): LeadActivityWithActor {
  const type = LeadActivityType.safeParse(row.type);
  return {
    id: row.id,
    leadId: row.leadId,
    actorId: row.actorId,
    type: type.success ? type.data : 'updated',
    payload: jsonObject(row.payload),
    createdAt: row.createdAt.toISOString(),
    actor: toUserSummary(actor),
  };
}
