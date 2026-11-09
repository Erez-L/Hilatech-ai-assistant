import type {
  Contact,
  ContactDetail,
  CreateContactRequest,
  ListContactsQuery,
  UpdateContactRequest,
} from '@hilatech/contracts';
import { api } from './client';

export type ListContactsParams = Partial<ListContactsQuery>;

export const contactsApi = {
  list: (query: ListContactsParams = {}) =>
    api.list<Contact>('/contacts', {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      tag: query.tag,
      ownerId: query.ownerId,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  get: (id: string) => api.get<ContactDetail>(`/contacts/${encodeURIComponent(id)}`),
  create: (body: CreateContactRequest) => api.post<Contact>('/contacts', body),
  update: (id: string, body: UpdateContactRequest) =>
    api.patch<ContactDetail>(`/contacts/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.delete<void>(`/contacts/${encodeURIComponent(id)}`),
  tags: () => api.get<string[]>('/contacts/tags'),
};
