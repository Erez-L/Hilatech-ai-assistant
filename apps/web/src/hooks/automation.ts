'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateWebhookEndpointRequest,
  CreateWebhookRequest,
  CreateWorkflowRequest,
  RunWorkflowRequest,
  UpdateWebhookEndpointRequest,
  UpdateWebhookRequest,
  UpdateWorkflowRequest,
  ValidateWorkflowRequest,
  WorkflowRunStatus,
} from '@hilatech/contracts';
import {
  keys,
  webhooksApi,
  workflowsApi,
  type ListWorkflowExecutionsParams,
  type ListWorkflowsParams,
} from '@/lib/api';
import { useActiveOrganizationId } from './queries';

export const WORKFLOW_POLL_MS = 2000;

export function isTerminalRun(status: WorkflowRunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

// ---- workflows -------------------------------------------------------------------------------

export function useWorkflows(params: ListWorkflowsParams = {}, options?: { enabled?: boolean }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.workflows(orgId, params),
    queryFn: () => workflowsApi.list(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

export function useWorkflow(id: string | null) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.workflow(orgId, id ?? ''),
    queryFn: () => workflowsApi.get(id as string),
    enabled: !!orgId && !!id,
  });
}

export function useWorkflowTemplates() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.workflowTemplates(orgId),
    queryFn: workflowsApi.templates,
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateWorkflowRequest) => workflowsApi.create(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.automationsRoot(orgId) }),
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWorkflowRequest }) =>
      workflowsApi.update(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.automationsRoot(orgId) }),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => workflowsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.automationsRoot(orgId) }),
  });
}

export function useSetWorkflowEnabled() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      workflowsApi.setEnabled(id, enabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.automationsRoot(orgId) }),
  });
}

export function useRunWorkflow() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RunWorkflowRequest }) =>
      workflowsApi.run(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.automationsRoot(orgId) }),
  });
}

export function useValidateWorkflow() {
  return useMutation({
    mutationFn: (body: ValidateWorkflowRequest) => workflowsApi.validate(body),
  });
}

// ---- executions ------------------------------------------------------------------------------

/** Execution list; polls every 2 s while any listed run is queued/running. */
export function useWorkflowExecutions(params: ListWorkflowExecutionsParams = {}) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.workflowExecutions(orgId, params),
    queryFn: () => workflowsApi.executions(params),
    enabled: !!orgId,
    placeholderData: (prev) => prev,
    refetchInterval: (query) =>
      query.state.data?.data.some((e) => !isTerminalRun(e.status)) ? WORKFLOW_POLL_MS : false,
  });
}

export function useWorkflowExecution(id: string | null) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.workflowExecution(orgId, id ?? ''),
    queryFn: () => workflowsApi.execution(id as string),
    enabled: !!orgId && !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminalRun(status) ? false : WORKFLOW_POLL_MS;
    },
  });
}

// ---- outbound webhooks -----------------------------------------------------------------------

export function useWebhooks() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.webhooks(orgId),
    queryFn: webhooksApi.list,
    enabled: !!orgId,
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateWebhookRequest) => webhooksApi.create(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhooks(orgId) }),
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWebhookRequest }) =>
      webhooksApi.update(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhooks(orgId) }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => webhooksApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhooks(orgId) }),
  });
}

export function useRotateWebhookSecret() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => webhooksApi.rotate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhooks(orgId) }),
  });
}

export function useTestWebhook() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => webhooksApi.test(id),
    onSuccess: (_d, id) =>
      void qc.invalidateQueries({
        queryKey: ['org', orgId, 'automations', 'webhooks', 'deliveries', id],
      }),
  });
}

/** Deliveries log; polls every 2 s while any delivery is still pending. */
export function useWebhookDeliveries(
  id: string | null,
  params: { page?: number; status?: 'pending' | 'delivered' | 'failed' } = {},
) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.webhookDeliveries(orgId, id ?? '', params),
    queryFn: () => webhooksApi.deliveries(id as string, { ...params, pageSize: 10 }),
    enabled: !!orgId && !!id,
    placeholderData: (prev) => prev,
    refetchInterval: (query) =>
      query.state.data?.data.some((d) => d.status === 'pending') ? WORKFLOW_POLL_MS : false,
  });
}

// ---- inbound endpoints -----------------------------------------------------------------------

export function useWebhookEndpoints() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.webhookEndpoints(orgId),
    queryFn: webhooksApi.endpoints,
    enabled: !!orgId,
  });
}

export function useCreateWebhookEndpoint() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateWebhookEndpointRequest) => webhooksApi.createEndpoint(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhookEndpoints(orgId) }),
  });
}

export function useUpdateWebhookEndpoint() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWebhookEndpointRequest }) =>
      webhooksApi.updateEndpoint(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhookEndpoints(orgId) }),
  });
}

export function useDeleteWebhookEndpoint() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => webhooksApi.removeEndpoint(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhookEndpoints(orgId) }),
  });
}

export function useRotateEndpointSecret() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => webhooksApi.rotateEndpoint(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhookEndpoints(orgId) }),
  });
}
