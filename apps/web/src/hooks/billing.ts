'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateBudgetRequest } from '@hilatech/contracts';
import { billingApi, keys } from '@/lib/api';
import { useActiveOrganizationId } from './queries';

export function useEntitlements() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.entitlements(orgId),
    queryFn: billingApi.entitlements,
    enabled: !!orgId,
  });
}

export function useUpgradeOptions() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.upgradeOptions(orgId),
    queryFn: billingApi.upgradeOptions,
    enabled: !!orgId,
  });
}

export function useBudget(options?: { enabled?: boolean }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.budget(orgId),
    queryFn: billingApi.budget,
    enabled: !!orgId && (options?.enabled ?? true),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: UpdateBudgetRequest) => billingApi.updateBudget(body),
    onSuccess: (status) => {
      qc.setQueryData(keys.budget(orgId), status);
      void qc.invalidateQueries({ queryKey: ['org', orgId, 'billing', 'alerts'] });
      void qc.invalidateQueries({ queryKey: keys.entitlements(orgId) });
      void qc.invalidateQueries({ queryKey: ['org', orgId, 'analytics', 'report', 'usage'] });
    },
  });
}

export function useBudgetAlerts(params: { page?: number; pageSize?: number }, enabled = true) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.budgetAlerts(orgId, params),
    queryFn: () => billingApi.alerts(params),
    enabled: !!orgId && enabled,
    placeholderData: (prev) => prev,
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (plan: Parameters<typeof billingApi.checkout>[0]) => billingApi.checkout(plan),
  });
}
