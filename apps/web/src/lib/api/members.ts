import type { Member, UpdateMemberRequest } from '@hilatech/contracts';
import { api } from './client';

export interface ListMembersParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export const membersApi = {
  list: (params: ListMembersParams = {}) =>
    api.list<Member>('/members', { page: params.page, pageSize: params.pageSize, search: params.search }),
  update: (id: string, body: UpdateMemberRequest) =>
    api.patch<Member>(`/members/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.delete<void>(`/members/${encodeURIComponent(id)}`),
  leave: () => api.delete<void>('/members/me'),
};
