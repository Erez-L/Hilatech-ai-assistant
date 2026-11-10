import { type TaskWithRelations } from '@hilatech/contracts';
import { type Prisma, type Task } from '@hilatech/database';

import {
  CONTACT_SUMMARY_SELECT,
  type ContactSummaryRow,
  USER_SUMMARY_SELECT,
  type UserSummaryRow,
  isoOrNull,
  toContactSummary,
  toUserSummary,
} from '../crm/crm.mappers';
import { TaskRules } from './task.rules';

export const TASK_INCLUDE = {
  assignee: { select: USER_SUMMARY_SELECT },
  createdBy: { select: USER_SUMMARY_SELECT },
  lead: { select: { id: true, title: true } },
  contact: { select: CONTACT_SUMMARY_SELECT },
  deal: { select: { id: true, title: true } },
  conversation: { select: { id: true, subject: true } },
} as const satisfies Prisma.TaskInclude;

export type TaskRow = Task & {
  assignee: UserSummaryRow | null;
  createdBy: UserSummaryRow | null;
  lead: { id: string; title: string } | null;
  contact: ContactSummaryRow | null;
  deal: { id: string; title: string } | null;
  conversation: { id: string; subject: string | null } | null;
};

export function toTaskWithRelations(row: TaskRow, now: Date = new Date()): TaskWithRelations {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: isoOrNull(row.dueAt),
    reminderAt: isoOrNull(row.reminderAt),
    reminderSentAt: isoOrNull(row.reminderSentAt),
    completedAt: isoOrNull(row.completedAt),
    assigneeId: row.assigneeId,
    createdById: row.createdById,
    source: row.source,
    leadId: row.leadId,
    contactId: row.contactId,
    dealId: row.dealId,
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignee: toUserSummary(row.assignee),
    createdBy: toUserSummary(row.createdBy),
    lead: row.lead,
    contact: toContactSummary(row.contact),
    deal: row.deal,
    conversation: row.conversation,
    isOverdue: TaskRules.isOverdue(row, now),
  };
}
