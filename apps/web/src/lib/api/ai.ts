import type {
  AiHealthCheckResult,
  AiModelInfo,
  AiProviderConfig,
  AiProviderKind,
  AiRequestLog,
  AiUsageSummary,
  CreateAiProviderConfigRequest,
  CreatePromptTemplateRequest,
  ListAiRequestLogsQuery,
  PaginationQuery,
  PromptTemplate,
  RenderPromptTemplateRequest,
  ToolDefinition,
  UpdateAiProviderConfigRequest,
  UpdatePromptTemplateRequest,
} from '@hilatech/contracts';
import { api } from './client';

const enc = encodeURIComponent;

export const aiApi = {
  // Providers
  providers: () => api.get<AiProviderConfig[]>('/ai/providers'),
  provider: (id: string) => api.get<AiProviderConfig>(`/ai/providers/${enc(id)}`),
  createProvider: (body: CreateAiProviderConfigRequest) =>
    api.post<AiProviderConfig>('/ai/providers', body),
  updateProvider: (id: string, body: UpdateAiProviderConfigRequest) =>
    api.patch<AiProviderConfig>(`/ai/providers/${enc(id)}`, body),
  removeProvider: (id: string) => api.delete<void>(`/ai/providers/${enc(id)}`),
  checkProvider: (id: string) =>
    api.post<AiHealthCheckResult>(`/ai/providers/${enc(id)}/health`, undefined, {}),
  models: (provider?: AiProviderKind) =>
    api.get<AiModelInfo[]>('/ai/models', { query: { provider } }),

  // Usage
  usageSummary: (range: { from?: string; to?: string } = {}) =>
    api.get<AiUsageSummary>('/ai/usage/summary', { query: range }),
  usageRequests: (query: Partial<ListAiRequestLogsQuery> = {}) =>
    api.list<AiRequestLog>('/ai/usage/requests', {
      page: query.page,
      pageSize: query.pageSize,
      agentId: query.agentId,
      userId: query.userId,
      provider: query.provider,
      status: query.status,
      from: query.from,
      to: query.to,
    }),

  // Prompt templates
  prompts: (query: Partial<PaginationQuery> = {}) =>
    api.list<PromptTemplate>('/ai/prompts', { page: query.page, pageSize: query.pageSize }),
  createPrompt: (body: CreatePromptTemplateRequest) =>
    api.post<PromptTemplate>('/ai/prompts', body),
  updatePrompt: (id: string, body: UpdatePromptTemplateRequest) =>
    api.patch<PromptTemplate>(`/ai/prompts/${enc(id)}`, body),
  removePrompt: (id: string) => api.delete<void>(`/ai/prompts/${enc(id)}`),
  renderPrompt: (id: string, body: RenderPromptTemplateRequest) =>
    api.post<RenderedPrompt>(`/ai/prompts/${enc(id)}/render`, body),

  // Tools
  tools: () => api.get<ToolDefinition[]>('/ai/tools'),
};

/** POST /ai/prompts/:id/render response (not in contracts yet). */
export interface RenderedPrompt {
  rendered: string;
  missing: string[];
}
