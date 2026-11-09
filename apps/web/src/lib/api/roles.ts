import type { CreateRoleRequest, Role, UpdateRoleRequest } from '@hilatech/contracts';
import { api } from './client';
import type { PermissionDefinition } from './types';

export const rolesApi = {
  permissions: () => api.get<PermissionDefinition[]>('/permissions'),
  list: () => api.get<Role[]>('/roles'),
  get: (id: string) => api.get<Role>(`/roles/${encodeURIComponent(id)}`),
  create: (body: CreateRoleRequest) => api.post<Role>('/roles', body),
  update: (id: string, body: UpdateRoleRequest) => api.patch<Role>(`/roles/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.delete<void>(`/roles/${encodeURIComponent(id)}`),
};
