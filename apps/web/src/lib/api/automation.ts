import type {
  CreateWebhookEndpointRequest,
  CreateWebhookRequest,
  CreateWorkflowRequest,
  ListWebhookDeliveriesQuery,
  RunWorkflowRequest,
  UpdateWebhookEndpointRequest,
  UpdateWebhookRequest,
  UpdateWorkflowRequest,
  ValidateWorkflowRequest,
  Webhook,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointWithSecret,
  WebhookWithSecret,
  Workflow,
  WorkflowExecution,
  WorkflowRunStatus,
  WorkflowTemplate,
  WorkflowValidationResult,
} from '@hilatech/contracts';
import { api } from './client';

const enc = encodeURIComponent;

export interface ListWorkflowsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  isEnabled?: boolean;
  triggerType?: 'manual' | 'event' | 'schedule' | 'webhook';
}

export interface ListWorkflowExecutionsParams {
  page?: number;
  pageSize?: number;
  workflowId?: string;
  status?: WorkflowRunStatus;
}

export const workflowsApi = {
  list: (q: ListWorkflowsParams = {}) =>
    api.list<Workflow>('/workflows', {
      page: q.page,
      pageSize: q.pageSize,
      search: q.search,
      isEnabled: q.isEnabled === undefined ? undefined : String(q.isEnabled),
      triggerType: q.triggerType,
    }),
  get: (id: string) => api.get<Workflow>(`/workflows/${enc(id)}`),
  create: (body: CreateWorkflowRequest) => api.post<Workflow>('/workflows', body),
  update: (id: string, body: UpdateWorkflowRequest) =>
    api.patch<Workflow>(`/workflows/${enc(id)}`, body),
  remove: (id: string) => api.delete<void>(`/workflows/${enc(id)}`),
  setEnabled: (id: string, enabled: boolean) =>
    api.post<Workflow>(`/workflows/${enc(id)}/${enabled ? 'enable' : 'disable'}`),
  run: (id: string, body: RunWorkflowRequest) =>
    api.post<WorkflowExecution>(`/workflows/${enc(id)}/run`, body),
  templates: () => api.get<WorkflowTemplate[]>('/workflows/templates'),
  validate: (body: ValidateWorkflowRequest) =>
    api.post<WorkflowValidationResult>('/workflows/validate', body),
  executions: (q: ListWorkflowExecutionsParams = {}) =>
    api.list<WorkflowExecution>('/workflow-executions', {
      page: q.page,
      pageSize: q.pageSize,
      workflowId: q.workflowId,
      status: q.status,
    }),
  execution: (id: string) => api.get<WorkflowExecution>(`/workflow-executions/${enc(id)}`),
};

export const webhooksApi = {
  // Outbound subscriptions
  list: () => api.get<Webhook[]>('/webhooks'),
  create: (body: CreateWebhookRequest) => api.post<WebhookWithSecret>('/webhooks', body),
  update: (id: string, body: UpdateWebhookRequest) =>
    api.patch<Webhook>(`/webhooks/${enc(id)}`, body),
  remove: (id: string) => api.delete<void>(`/webhooks/${enc(id)}`),
  rotate: (id: string) => api.post<WebhookWithSecret>(`/webhooks/${enc(id)}/rotate-secret`),
  test: (id: string) => api.post<WebhookDelivery>(`/webhooks/${enc(id)}/test`),
  deliveries: (id: string, q: Partial<ListWebhookDeliveriesQuery> = {}) =>
    api.list<WebhookDelivery>(`/webhooks/${enc(id)}/deliveries`, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      event: q.event,
    }),

  // Inbound endpoints
  endpoints: () => api.get<WebhookEndpoint[]>('/webhook-endpoints'),
  createEndpoint: (body: CreateWebhookEndpointRequest) =>
    api.post<WebhookEndpointWithSecret>('/webhook-endpoints', body),
  updateEndpoint: (id: string, body: UpdateWebhookEndpointRequest) =>
    api.patch<WebhookEndpoint>(`/webhook-endpoints/${enc(id)}`, body),
  removeEndpoint: (id: string) => api.delete<void>(`/webhook-endpoints/${enc(id)}`),
  rotateEndpoint: (id: string) =>
    api.post<WebhookEndpointWithSecret>(`/webhook-endpoints/${enc(id)}/rotate-secret`),
};
