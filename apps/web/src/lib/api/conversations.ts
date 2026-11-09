import type {
  AssignConversationRequest,
  ConversationWithRelations,
  CreateConversationRequest,
  CreateMessageRequest,
  ListConversationsQuery,
  ListMessagesQuery,
  MessageWithAuthor,
  UpdateConversationRequest,
} from '@hilatech/contracts';
import { api } from './client';

/**
 * `leadId` is not part of `listConversationsQuerySchema` yet; the lead detail page sends it to list
 * the conversations linked to a lead (see apps/web/README.md → Contract gaps).
 */
export type ListConversationsParams = Partial<ListConversationsQuery> & { leadId?: string };

export const conversationsApi = {
  list: (query: ListConversationsParams = {}) =>
    api.list<ConversationWithRelations>('/conversations', {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      status: query.status,
      channel: query.channel,
      assigneeId: query.assigneeId,
      contactId: query.contactId,
      leadId: query.leadId,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  get: (id: string) =>
    api.get<ConversationWithRelations>(`/conversations/${encodeURIComponent(id)}`),
  create: (body: CreateConversationRequest) =>
    api.post<ConversationWithRelations>('/conversations', body),
  update: (id: string, body: UpdateConversationRequest) =>
    api.patch<ConversationWithRelations>(`/conversations/${encodeURIComponent(id)}`, body),
  assign: (id: string, body: AssignConversationRequest) =>
    api.post<ConversationWithRelations>(`/conversations/${encodeURIComponent(id)}/assign`, body),
  messages: (id: string, query: Partial<ListMessagesQuery> = {}) =>
    api.list<MessageWithAuthor>(`/conversations/${encodeURIComponent(id)}/messages`, {
      page: query.page,
      pageSize: query.pageSize,
      sortOrder: query.sortOrder,
    }),
  sendMessage: (id: string, body: CreateMessageRequest) =>
    api.post<MessageWithAuthor>(`/conversations/${encodeURIComponent(id)}/messages`, body),
};
