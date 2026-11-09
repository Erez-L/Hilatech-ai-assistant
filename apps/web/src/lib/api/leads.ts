import type {
  AssignLeadRequest,
  Contact,
  ConvertLeadRequest,
  CreateLeadRequest,
  LeadActivityWithActor,
  LeadNoteWithAuthor,
  LeadWithRelations,
  ListLeadsQuery,
  PaginationQuery,
  UpdateLeadRequest,
} from '@hilatech/contracts';
import { api } from './client';

export type ListLeadsParams = Partial<ListLeadsQuery>;

/** POST /leads/:id/convert */
export interface ConvertLeadResponse {
  lead: LeadWithRelations;
  contact: Contact;
}

export const leadsApi = {
  list: (query: ListLeadsParams = {}) =>
    api.list<LeadWithRelations>('/leads', {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      status: query.status,
      source: query.source,
      assigneeId: query.assigneeId,
      contactId: query.contactId,
      tag: query.tag,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  get: (id: string) => api.get<LeadWithRelations>(`/leads/${encodeURIComponent(id)}`),
  create: (body: CreateLeadRequest) => api.post<LeadWithRelations>('/leads', body),
  update: (id: string, body: UpdateLeadRequest) =>
    api.patch<LeadWithRelations>(`/leads/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.delete<void>(`/leads/${encodeURIComponent(id)}`),
  assign: (id: string, body: AssignLeadRequest) =>
    api.post<LeadWithRelations>(`/leads/${encodeURIComponent(id)}/assign`, body),
  convert: (id: string, body: ConvertLeadRequest) =>
    api.post<ConvertLeadResponse>(`/leads/${encodeURIComponent(id)}/convert`, body),
  notes: (id: string, query: Partial<PaginationQuery> = {}) =>
    api.list<LeadNoteWithAuthor>(`/leads/${encodeURIComponent(id)}/notes`, {
      page: query.page,
      pageSize: query.pageSize,
    }),
  addNote: (id: string, body: { body: string }) =>
    api.post<LeadNoteWithAuthor>(`/leads/${encodeURIComponent(id)}/notes`, body),
  removeNote: (id: string, noteId: string) =>
    api.delete<void>(`/leads/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`),
  activities: (id: string, query: Partial<PaginationQuery> = {}) =>
    api.list<LeadActivityWithActor>(`/leads/${encodeURIComponent(id)}/activities`, {
      page: query.page,
      pageSize: query.pageSize,
    }),
};
