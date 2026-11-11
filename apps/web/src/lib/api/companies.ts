import type {
  AssociateContactsResult,
  Company,
  CompanyDetail,
  Contact,
  CreateCompanyRequest,
  ListCompaniesQuery,
  PaginationQuery,
  UpdateCompanyRequest,
} from '@hilatech/contracts';
import { api } from './client';

export type ListCompaniesParams = Partial<ListCompaniesQuery>;
const enc = encodeURIComponent;

export const companiesApi = {
  list: (query: ListCompaniesParams = {}) =>
    api.list<Company>('/companies', {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      tag: query.tag,
      ownerId: query.ownerId,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  get: (id: string) => api.get<CompanyDetail>(`/companies/${enc(id)}`),
  create: (body: CreateCompanyRequest) => api.post<CompanyDetail>('/companies', body),
  update: (id: string, body: UpdateCompanyRequest) =>
    api.patch<CompanyDetail>(`/companies/${enc(id)}`, body),
  remove: (id: string) => api.delete<void>(`/companies/${enc(id)}`),
  contacts: (id: string, query: Partial<PaginationQuery> = {}) =>
    api.list<Contact>(`/companies/${enc(id)}/contacts`, {
      page: query.page,
      pageSize: query.pageSize,
    }),
  associate: (id: string, contactIds: string[]) =>
    api.post<AssociateContactsResult>(`/companies/${enc(id)}/contacts`, { contactIds }),
  dissociate: (id: string, contactId: string) =>
    api.delete<void>(`/companies/${enc(id)}/contacts/${enc(contactId)}`),
};
