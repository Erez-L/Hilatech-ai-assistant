import {
  type Conversation as ConversationDto,
  type ConversationWithRelations,
  type MessageWithAuthor,
} from '@hilatech/contracts';
import { type Conversation, type Lead, type Message, type Prisma } from '@hilatech/database';
import { truncate } from '@hilatech/shared';

import {
  CONTACT_SUMMARY_SELECT,
  type ContactSummaryRow,
  USER_SUMMARY_SELECT,
  type UserSummaryRow,
  isoOrNull,
  jsonObject,
  toContactSummary,
  toUserSummary,
} from '../crm/crm.mappers';

/** Length of the `lastMessage.content` preview embedded in conversation listings. */
export const LAST_MESSAGE_PREVIEW_LENGTH = 200;

export const CONVERSATION_INCLUDE = {
  contact: { select: CONTACT_SUMMARY_SELECT },
  lead: { select: { id: true, title: true, status: true } },
  assignee: { select: USER_SUMMARY_SELECT },
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { role: true, content: true },
  },
} as const satisfies Prisma.ConversationInclude;

export type ConversationRow = Conversation & {
  contact: ContactSummaryRow | null;
  lead: Pick<Lead, 'id' | 'title' | 'status'> | null;
  assignee: UserSummaryRow | null;
  messages: Array<Pick<Message, 'role' | 'content'>>;
};

export function toConversation(row: Conversation): ConversationDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    subject: row.subject,
    status: row.status,
    channel: row.channel,
    contactId: row.contactId,
    leadId: row.leadId,
    assigneeId: row.assigneeId,
    summary: row.summary,
    lastMessageAt: isoOrNull(row.lastMessageAt),
    messageCount: row.messageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConversationWithRelations(row: ConversationRow): ConversationWithRelations {
  const last = row.messages[0];
  return {
    ...toConversation(row),
    contact: toContactSummary(row.contact),
    lead: row.lead ? { id: row.lead.id, title: row.lead.title, status: row.lead.status } : null,
    assignee: toUserSummary(row.assignee),
    lastMessage: last
      ? { role: last.role, content: truncate(last.content, LAST_MESSAGE_PREVIEW_LENGTH) }
      : null,
  };
}

export const MESSAGE_INCLUDE = {
  author: { select: USER_SUMMARY_SELECT },
} as const satisfies Prisma.MessageInclude;

export type MessageRow = Message & { author: UserSummaryRow | null };

export function toMessage(row: MessageRow): MessageWithAuthor {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    authorUserId: row.authorUserId,
    content: row.content,
    metadata: jsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    author: toUserSummary(row.author),
  };
}
