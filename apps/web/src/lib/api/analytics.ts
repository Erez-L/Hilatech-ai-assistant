import type { DashboardPeriod, DashboardSummary } from '@hilatech/contracts';
import { api } from './client';

export const analyticsApi = {
  /** GET /analytics/dashboard?period=7d|30d|90d → DashboardSummary (contracts/analytics.ts). */
  dashboard: (period: DashboardPeriod = '30d') =>
    api.get<DashboardSummary>('/analytics/dashboard', { query: { period } }),
};
