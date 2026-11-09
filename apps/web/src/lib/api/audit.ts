import type { AuditLog, ListAuditLogsQuery } from '@hilatech/contracts';
import { api } from './client';

export const auditApi = {
  list: (query: Partial<ListAuditLogsQuery> = {}) =>
    api.list<AuditLog>('/audit-logs', {
      page: query.page,
      pageSize: query.pageSize,
      action: query.action,
      actorUserId: query.actorUserId,
      targetType: query.targetType,
      from: query.from,
      to: query.to,
    }),
};
