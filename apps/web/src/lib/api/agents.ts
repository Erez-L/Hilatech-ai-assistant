import type {
  Agent,
  AgentExecution,
  AgentExecutionDetail,
  CreateAgentRequest,
  ExecuteAgentRequest,
  ListAgentExecutionsQuery,
  ListAgentsQuery,
  UpdateAgentRequest,
} from '@hilatech/contracts';
import { api } from './client';

const enc = encodeURIComponent;

export type ListAgentsParams = Partial<ListAgentsQuery>;
export type ListAgentExecutionsParams = Partial<ListAgentExecutionsQuery>;

/** POST /agents/:id/execute: 202 queued execution (async) or 200 detail (sync); both carry `id` and `status`. */
export type ExecuteAgentResponse = AgentExecution | AgentExecutionDetail;

export const agentsApi = {
  list: (q: ListAgentsParams = {}) =>
    api.list<Agent>('/agents', {
      page: q.page,
      pageSize: q.pageSize,
      search: q.search,
      isEnabled: q.isEnabled === undefined ? undefined : String(q.isEnabled),
    }),
  get: (id: string) => api.get<Agent>(`/agents/${enc(id)}`),
  create: (body: CreateAgentRequest) => api.post<Agent>('/agents', body),
  update: (id: string, body: UpdateAgentRequest) => api.patch<Agent>(`/agents/${enc(id)}`, body),
  remove: (id: string) => api.delete<void>(`/agents/${enc(id)}`),
  execute: (id: string, body: ExecuteAgentRequest) =>
    api.post<ExecuteAgentResponse>(`/agents/${enc(id)}/execute`, body),
  executions: (q: ListAgentExecutionsParams = {}) =>
    api.list<AgentExecution>('/agents/executions', {
      page: q.page,
      pageSize: q.pageSize,
      agentId: q.agentId,
      status: q.status,
      trigger: q.trigger,
      rootOnly: q.rootOnly === undefined ? undefined : String(q.rootOnly),
    }),
  execution: (id: string) => api.get<AgentExecutionDetail>(`/agents/executions/${enc(id)}`),
  cancelExecution: (id: string) => api.post<AgentExecution>(`/agents/executions/${enc(id)}/cancel`),
};
