import type {
  CreateIntegrationRequest,
  Integration,
  IntegrationCatalogueEntry,
  IntegrationTestResult,
  UpdateIntegrationRequest,
} from '@hilatech/contracts';
import { api } from './client';

const enc = encodeURIComponent;

export interface IntegrationStatusEntry {
  kind: string;
  liveSupport: 'full' | 'partial' | 'planned';
  connected: number;
  total: number;
  availability: 'available' | 'not_configured';
}

export const integrationsApi = {
  catalog: () => api.get<IntegrationCatalogueEntry[]>('/integrations/catalog'),
  status: () => api.get<IntegrationStatusEntry[]>('/integrations/status'),
  list: () => api.get<Integration[]>('/integrations'),
  connect: (body: CreateIntegrationRequest) => api.post<Integration>('/integrations', body),
  update: (id: string, body: UpdateIntegrationRequest) =>
    api.patch<Integration>(`/integrations/${enc(id)}`, body),
  test: (id: string) => api.post<IntegrationTestResult>(`/integrations/${enc(id)}/test`),
  disconnect: (id: string) => api.delete<void>(`/integrations/${enc(id)}`),
};
