'use client';

import { useQuery } from '@tanstack/react-query';
import { analyticsApi, keys, type AnalyticsRangeParams } from '@/lib/api';
import { useActiveOrganizationId } from './queries';

type Report = 'business' | 'sales' | 'agents' | 'automation' | 'usage';

function useReport<T>(
  report: Report,
  range: AnalyticsRangeParams,
  fetcher: (range: AnalyticsRangeParams) => Promise<T>,
  enabled: boolean,
) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.analyticsReport(orgId, report, range),
    queryFn: () => fetcher(range),
    enabled: !!orgId && enabled,
    placeholderData: (prev) => prev,
  });
}

/** Each report only loads while its tab is mounted/active (`enabled`). */
export const useBusinessAnalytics = (range: AnalyticsRangeParams, enabled = true) =>
  useReport('business', range, analyticsApi.business, enabled);
export const useSalesAnalytics = (range: AnalyticsRangeParams, enabled = true) =>
  useReport('sales', range, analyticsApi.sales, enabled);
export const useAgentAnalytics = (range: AnalyticsRangeParams, enabled = true) =>
  useReport('agents', range, analyticsApi.agents, enabled);
export const useAutomationAnalytics = (range: AnalyticsRangeParams, enabled = true) =>
  useReport('automation', range, analyticsApi.automation, enabled);
export const useUsageAnalytics = (range: AnalyticsRangeParams, enabled = true) =>
  useReport('usage', range, analyticsApi.usage, enabled);
