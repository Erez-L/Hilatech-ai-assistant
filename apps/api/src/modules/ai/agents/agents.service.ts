import {
  type Agent as AgentDto,
  AuditAction,
  type CreateAgentRequest,
  type ListAgentsQuery,
  type UpdateAgentRequest,
} from '@hilatech/contracts';
import { type Prisma } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { type RequestMeta } from '../../../common/request';
import { type PageResult, page, skipTake } from '../../../common/utils/pagination';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AiToolsService } from '../tools/ai-tools.service';
import { AgentRules } from './agent.rules';
import { AGENT_INCLUDE, type AgentRow, toAgent } from './agents.mappers';

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tools: AiToolsService,
  ) {}

  async list(tenant: TenantContext, query: ListAgentsQuery): Promise<PageResult<AgentDto>> {
    const where: Prisma.AgentWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.agent.findMany({
        where,
        include: AGENT_INCLUDE,
        orderBy: { name: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.client.agent.count({ where }),
    ]);
    return page(rows.map(toAgent), query, total);
  }

  async get(tenant: TenantContext, id: string): Promise<AgentDto> {
    return toAgent(await this.requireAgent(tenant, id));
  }

  async create(
    tenant: TenantContext,
    dto: CreateAgentRequest,
    meta: RequestMeta,
  ): Promise<AgentDto> {
    const tools = this.validateTools(dto.tools);
    if (dto.providerConfigId) await this.assertProviderConfig(tenant, dto.providerConfigId);
    await this.assertDelegationTargets(tenant, dto.permissions.delegateTo, null);
    await this.assertNameFree(tenant, dto.name);

    const created = await this.prisma.client.agent.create({
      data: {
        organizationId: tenant.organizationId,
        name: dto.name,
        description: dto.description ?? null,
        instructions: dto.instructions,
        providerConfigId: dto.providerConfigId ?? null,
        model: dto.model ?? null,
        temperature: dto.temperature ?? null,
        maxOutputTokens: dto.maxOutputTokens ?? null,
        tools,
        permissions: dto.permissions as Prisma.InputJsonObject,
        knowledgeBaseIds: dto.knowledgeBaseIds,
        maxSteps: dto.maxSteps,
        maxDurationMs: dto.maxDurationMs,
        maxTokens: dto.maxTokens,
        maxDelegations: dto.maxDelegations,
        retryPolicy: dto.retryPolicy as Prisma.InputJsonObject,
        isEnabled: dto.isEnabled,
        createdById: tenant.userId,
      },
      include: AGENT_INCLUDE,
    });
    await this.audit.log({
      action: AuditAction.AGENT_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'agent',
      targetId: created.id,
      metadata: { name: created.name, tools: created.tools, permissions: dto.permissions },
      request: meta,
    });
    return toAgent(created);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateAgentRequest,
    meta: RequestMeta,
  ): Promise<AgentDto> {
    const existing = await this.requireAgent(tenant, id);
    const data: Prisma.AgentUncheckedUpdateInput = {};
    const changes: string[] = [];

    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameFree(tenant, dto.name);
      data.name = dto.name;
      changes.push('name');
    }
    if (dto.tools !== undefined) {
      data.tools = this.validateTools(dto.tools);
      changes.push('tools');
    }
    if (dto.providerConfigId !== undefined && dto.providerConfigId !== existing.providerConfigId) {
      await this.assertProviderConfig(tenant, dto.providerConfigId);
      data.providerConfigId = dto.providerConfigId;
      changes.push('providerConfigId');
    }
    if (dto.permissions !== undefined) {
      await this.assertDelegationTargets(tenant, dto.permissions.delegateTo, existing.id);
      data.permissions = dto.permissions as Prisma.InputJsonObject;
      changes.push('permissions');
    }
    const scalar = <K extends keyof UpdateAgentRequest & keyof Prisma.AgentUncheckedUpdateInput>(
      key: K,
    ) => {
      const value = dto[key];
      if (value === undefined) return;
      if (value === (existing as Record<string, unknown>)[key]) return;
      (data as Record<string, unknown>)[key] = value;
      changes.push(key);
    };
    scalar('description');
    scalar('instructions');
    scalar('model');
    scalar('temperature');
    scalar('maxOutputTokens');
    scalar('maxSteps');
    scalar('maxDurationMs');
    scalar('maxTokens');
    scalar('maxDelegations');
    scalar('isEnabled');
    if (dto.knowledgeBaseIds !== undefined) {
      data.knowledgeBaseIds = dto.knowledgeBaseIds;
      changes.push('knowledgeBaseIds');
    }
    if (dto.retryPolicy !== undefined) {
      data.retryPolicy = dto.retryPolicy as Prisma.InputJsonObject;
      changes.push('retryPolicy');
    }
    if (changes.length === 0) return toAgent(existing);

    const updated = await this.prisma.client.agent.update({
      where: { id: existing.id },
      data,
      include: AGENT_INCLUDE,
    });
    await this.audit.log({
      action: AuditAction.AGENT_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'agent',
      targetId: existing.id,
      metadata: { changes },
      request: meta,
    });
    return toAgent(updated);
  }

  /** Hard delete (executions cascade); refused while executions are queued or running. */
  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const existing = await this.requireAgent(tenant, id);
    const active = await this.prisma.client.agentExecution.count({
      where: { agentId: existing.id, status: { in: ['queued', 'running'] } },
    });
    if (active > 0) {
      throw AppException.conflict(
        `Agent has ${active} queued/running execution(s); cancel them before deleting`,
        { activeExecutions: active },
      );
    }
    await this.prisma.client.agent.delete({ where: { id: existing.id } });
    await this.audit.log({
      action: AuditAction.AGENT_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'agent',
      targetId: existing.id,
      metadata: { name: existing.name },
      request: meta,
    });
  }

  async requireAgent(tenant: TenantContext, id: string): Promise<AgentRow> {
    const row = await this.prisma.client.agent.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: AGENT_INCLUDE,
    });
    if (!row) throw AppException.notFound('Agent');
    return row;
  }

  // ---------------------------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------------------------

  private validateTools(keys: readonly string[]): string[] {
    const { tools, unknown } = this.tools.validateAgentTools(keys);
    AgentRules.assertKnownTools(unknown);
    return tools;
  }

  private async assertProviderConfig(tenant: TenantContext, configId: string): Promise<void> {
    const config = await this.prisma.client.aiProviderConfig.findFirst({
      where: { id: configId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!config) {
      throw AppException.validation('Referenced provider configuration not found', [
        {
          path: 'providerConfigId',
          message: 'Provider configuration not found in this organization',
          code: 'custom',
        },
      ]);
    }
  }

  private async assertDelegationTargets(
    tenant: TenantContext,
    ids: readonly string[],
    selfId: string | null,
  ): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.prisma.client.agent.findMany({
      where: { organizationId: tenant.organizationId, id: { in: [...ids] } },
      select: { id: true },
    });
    AgentRules.assertDelegationTargets(
      ids,
      found.map((a) => a.id),
      selfId,
    );
  }

  private async assertNameFree(tenant: TenantContext, name: string): Promise<void> {
    const clash = await this.prisma.client.agent.findFirst({
      where: { organizationId: tenant.organizationId, name },
      select: { id: true },
    });
    if (clash) throw AppException.conflict(`An agent named "${name}" already exists`);
  }
}
