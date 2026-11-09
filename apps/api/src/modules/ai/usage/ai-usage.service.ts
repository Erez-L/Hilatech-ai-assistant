import {
  type AiRequestLog as AiRequestLogDto,
  type AiUsageSummary,
  type ListAiRequestLogsQuery,
} from '@hilatech/contracts';
import { type AiRequestLog, type Prisma } from '@hilatech/database';
import { monthPeriod } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { type PageResult, page, skipTake } from '../../../common/utils/pagination';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EntitlementsService } from '../../billing/entitlements.service';
import { decimalToNumber } from '../../crm/crm.mappers';
import { type UsageRow, buildUsageSummary } from './usage-summary';

export interface UsageSummaryQuery {
  from?: string;
  to?: string;
}

@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Aggregates `AiRequestLog` for the period (default: the current UTC month) plus the plan limit. */
  async summary(tenant: TenantContext, query: UsageSummaryQuery): Promise<AiUsageSummary> {
    const period = resolvePeriod(query);
    const rows = await this.prisma.client.aiRequestLog.findMany({
      where: {
        organizationId: tenant.organizationId,
        createdAt: { gte: period.from, lt: period.to },
      },
      select: {
        provider: true,
        model: true,
        agentId: true,
        status: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
      },
    });
    const usageRows: UsageRow[] = rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      agentId: r.agentId,
      status: r.status,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      estimatedCostUsd: decimalToNumber(r.estimatedCostUsd),
    }));

    const agentIds = [...new Set(usageRows.map((r) => r.agentId).filter((v): v is string => !!v))];
    const agents = agentIds.length
      ? await this.prisma.client.agent.findMany({
          where: { organizationId: tenant.organizationId, id: { in: agentIds } },
          select: { id: true, name: true },
        })
      : [];
    const check = await this.entitlements.check(tenant, 'ai_tokens');

    return buildUsageSummary({
      period,
      rows: usageRows,
      agentNames: new Map(agents.map((a) => [a.id, a.name])),
      limit: { tokens: check.limit, used: check.used },
    });
  }

  async listRequests(
    tenant: TenantContext,
    query: ListAiRequestLogsQuery,
  ): Promise<PageResult<AiRequestLogDto>> {
    const where: Prisma.AiRequestLogWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.agentId ? { agentId: query.agentId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.aiRequestLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.aiRequestLog.count({ where }),
    ]);
    return page(rows.map(toAiRequestLog), query, total);
  }
}

export function toAiRequestLog(row: AiRequestLog): AiRequestLogDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    agentId: row.agentId,
    executionId: row.executionId,
    threadId: row.threadId,
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    status: row.status,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    durationMs: row.durationMs,
    estimatedCostUsd: decimalToNumber(row.estimatedCostUsd),
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `from`/`to` are ISO timestamps; both default to the current UTC month. `to` is exclusive. */
export function resolvePeriod(query: UsageSummaryQuery, now = new Date()): { from: Date; to: Date } {
  const month = monthPeriod(now);
  const from = query.from ? new Date(query.from) : month.start;
  const to = query.to ? new Date(query.to) : query.from ? now : month.end;
  if (to.getTime() <= from.getTime()) {
    throw AppException.validation('`to` must be after `from`', [
      { path: 'to', message: 'Period end must be after its start', code: 'custom' },
    ]);
  }
  return { from, to };
}
