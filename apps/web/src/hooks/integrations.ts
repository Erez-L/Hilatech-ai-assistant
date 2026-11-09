'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateIntegrationRequest, UpdateIntegrationRequest } from '@hilatech/contracts';
import { integrationsApi, keys } from '@/lib/api';
import { useActiveOrganizationId } from './queries';

export function useIntegrationCatalog() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.integrationCatalog(orgId),
    queryFn: integrationsApi.catalog,
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
}

export function useIntegrationStatus() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.integrationStatus(orgId),
    queryFn: integrationsApi.status,
    enabled: !!orgId,
  });
}

export function useIntegrations() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.integrations(orgId),
    queryFn: integrationsApi.list,
    enabled: !!orgId,
  });
}

function useInvalidateIntegrations() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return () => void qc.invalidateQueries({ queryKey: keys.integrationsRoot(orgId) });
}

export function useConnectIntegration() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({
    mutationFn: (body: CreateIntegrationRequest) => integrationsApi.connect(body),
    onSuccess: invalidate,
  });
}

export function useUpdateIntegration() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateIntegrationRequest }) =>
      integrationsApi.update(id, body),
    onSuccess: invalidate,
  });
}

export function useTestIntegration() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({
    mutationFn: (id: string) => integrationsApi.test(id),
    onSuccess: invalidate,
  });
}

export function useDisconnectIntegration() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({
    mutationFn: (id: string) => integrationsApi.disconnect(id),
    onSuccess: invalidate,
  });
}
