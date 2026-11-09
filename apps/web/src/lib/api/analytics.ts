import type {
  AgentAnalytics,
  AnalyticsExportQuery,
  AnalyticsGranularity,
  AutomationAnalytics,
  BusinessAnalytics,
  DashboardPeriod,
  DashboardSummary,
  SalesAnalytics,
  UsageAnalytics,
} from '@hilatech/contracts';
import { api } from './client';

/** Query shared by every report endpoint (`to` is exclusive; both are ISO datetimes). */
export interface AnalyticsRangeParams {
  from?: string;
  to?: string;
  granularity?: AnalyticsGranularity;
}

export interface CsvDownload {
  blob: Blob;
  filename: string;
}

/** Reads the filename from a Content-Disposition header, falling back to the supplied name. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? fallback;
}

export const analyticsApi = {
  /** GET /analytics/dashboard?period=7d|30d|90d → DashboardSummary (contracts/analytics.ts). */
  dashboard: (period: DashboardPeriod = '30d') =>
    api.get<DashboardSummary>('/analytics/dashboard', { query: { period } }),

  business: (range: AnalyticsRangeParams) =>
    api.get<BusinessAnalytics>('/analytics/business', { query: { ...range } }),
  sales: (range: AnalyticsRangeParams) =>
    api.get<SalesAnalytics>('/analytics/sales', { query: { ...range } }),
  agents: (range: AnalyticsRangeParams) =>
    api.get<AgentAnalytics>('/analytics/agents', { query: { ...range } }),
  automation: (range: AnalyticsRangeParams) =>
    api.get<AutomationAnalytics>('/analytics/automation', { query: { ...range } }),
  usage: (range: AnalyticsRangeParams) =>
    api.get<UsageAnalytics>('/analytics/usage', { query: { ...range } }),

  /** GET /analytics/export → text/csv attachment (authenticated, so fetched as a blob, not a plain link). */
  async exportCsv(
    query: Pick<AnalyticsExportQuery, 'report' | 'section'> & AnalyticsRangeParams,
  ): Promise<CsvDownload> {
    const res = await api.fetchRaw('/analytics/export', {
      query: { ...query },
      headers: { Accept: 'text/csv' },
    });
    const blob = await res.blob();
    return {
      blob,
      filename: filenameFromDisposition(
        res.headers.get('content-disposition'),
        // Content-Disposition is not exposed to cross-origin scripts unless the API lists it in
        // Access-Control-Expose-Headers, so fall back to the same naming scheme the server uses.
        `${query.report}-${query.section}-${(query.from ?? '').slice(0, 10)}_${(query.to ?? '').slice(0, 10)}.csv`,
      ),
    };
  },
};
