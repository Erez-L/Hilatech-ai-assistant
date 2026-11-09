import {
  type AuditAction,
  type AuditLog as AuditLogDto,
  type ListAuditLogsQuery,
} from '@hilatech/contracts';
import { type AuditLog, type Prisma } from '@hilatech/database';
import { redactSensitive } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { type AppRequest, type RequestMeta, requestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface AuditEntry {
  action: AuditAction;
  organizationId?: string | null;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  /** Either the raw request (ip / user agent / request id are extracted) or pre-extracted metadata. */
  request?: AppRequest | RequestMeta | null;
}

function isRequestMeta(value: AppRequest | RequestMeta): value is RequestMeta {
  return 'ipAddress' in value && 'userAgent' in value && !('headers' in value);
}

/**
 * Writes `AuditLog` rows. Never throws: an audit failure must not fail the business operation,
 * but it is logged at error level so it is visible in monitoring.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    const meta: RequestMeta = entry.request
      ? isRequestMeta(entry.request)
        ? entry.request
        : requestMeta(entry.request)
      : { ipAddress: null, userAgent: null, requestId: null };
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: entry.action,
          organizationId: entry.organizationId ?? null,
          actorUserId: entry.actorUserId ?? null,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          metadata: redactSensitive(entry.metadata ?? {}) as Prisma.InputJsonObject,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          requestId: meta.requestId ? meta.requestId.slice(0, 64) : null,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, action: entry.action },
        'Failed to write audit log',
        AuditService.name,
      );
    }
  }

  async list(tenant: TenantContext, query: ListAuditLogsQuery): Promise<PageResult<AuditLogDto>> {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);
    return page(rows.map(toAuditLogDto), query, total);
  }
}

export function toAuditLogDto(row: AuditLog): AuditLogDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    actorUserId: row.actorUserId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}
