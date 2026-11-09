import type {
  CreateOrganizationRequest,
  Organization,
  OrganizationSettings,
  OrganizationSummary,
  UpdateOrganizationRequest,
} from '@hilatech/contracts';
import { api } from './client';

export const organizationsApi = {
  list: () => api.get<OrganizationSummary[]>('/organizations', { organization: false }),
  create: (body: CreateOrganizationRequest) =>
    api.post<Organization>('/organizations', body, { organization: false }),
  current: () => api.get<Organization>('/organizations/current'),
  update: (body: UpdateOrganizationRequest) => api.patch<Organization>('/organizations/current', body),
  remove: () => api.delete<void>('/organizations/current'),
  settings: () => api.get<OrganizationSettings>('/organizations/current/settings'),
  updateSettings: (body: OrganizationSettings) =>
    api.put<OrganizationSettings>('/organizations/current/settings', body),
};
