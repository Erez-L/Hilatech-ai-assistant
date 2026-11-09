import { extractVariables, renderTemplate } from '@hilatech/ai-engine';
import {
  AuditAction,
  type CreatePromptTemplateRequest,
  type PaginationQuery,
  type PromptTemplate as PromptTemplateDto,
  type RenderPromptTemplateRequest,
  type UpdatePromptTemplateRequest,
} from '@hilatech/contracts';
import { type Prisma, type PromptTemplate } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { type RequestMeta } from '../../../common/request';
import { type PageResult, page, skipTake } from '../../../common/utils/pagination';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

export interface RenderedPrompt {
  rendered: string;
  /** Variables referenced by the template that were not supplied (or were null). */
  missing: string[];
}

@Injectable()
export class PromptTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    query: PaginationQuery,
  ): Promise<PageResult<PromptTemplateDto>> {
    const where = { organizationId: tenant.organizationId };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.promptTemplate.findMany({
        where,
        orderBy: [{ isSystem: 'desc' }, { key: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.client.promptTemplate.count({ where }),
    ]);
    return page(rows.map(toPromptTemplate), query, total);
  }

  async get(tenant: TenantContext, id: string): Promise<PromptTemplateDto> {
    return toPromptTemplate(await this.requireTemplate(tenant, id));
  }

  async create(
    tenant: TenantContext,
    dto: CreatePromptTemplateRequest,
    meta: RequestMeta,
  ): Promise<PromptTemplateDto> {
    const clash = await this.prisma.client.promptTemplate.findFirst({
      where: { organizationId: tenant.organizationId, key: dto.key },
      select: { id: true },
    });
    if (clash)
      throw AppException.conflict(`A prompt template with key "${dto.key}" already exists`);

    const created = await this.prisma.client.promptTemplate.create({
      data: {
        organizationId: tenant.organizationId,
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        content: dto.content,
        variables: extractVariables(dto.content),
      },
    });
    await this.audit.log({
      action: AuditAction.PROMPT_TEMPLATE_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'prompt_template',
      targetId: created.id,
      metadata: { key: created.key, variables: created.variables },
      request: meta,
    });
    return toPromptTemplate(created);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdatePromptTemplateRequest,
    meta: RequestMeta,
  ): Promise<PromptTemplateDto> {
    const existing = await this.requireTemplate(tenant, id);
    const data: Prisma.PromptTemplateUncheckedUpdateInput = {};
    const changes: string[] = [];
    if (dto.name !== undefined && dto.name !== existing.name) {
      data.name = dto.name;
      changes.push('name');
    }
    if (dto.description !== undefined && dto.description !== existing.description) {
      data.description = dto.description;
      changes.push('description');
    }
    if (dto.content !== undefined && dto.content !== existing.content) {
      data.content = dto.content;
      data.variables = extractVariables(dto.content);
      data.version = { increment: 1 };
      changes.push('content');
    }
    if (changes.length === 0) return toPromptTemplate(existing);

    const updated = await this.prisma.client.promptTemplate.update({
      where: { id: existing.id },
      data,
    });
    await this.audit.log({
      action: AuditAction.PROMPT_TEMPLATE_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'prompt_template',
      targetId: existing.id,
      metadata: { key: existing.key, changes, version: updated.version },
      request: meta,
    });
    return toPromptTemplate(updated);
  }

  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const existing = await this.requireTemplate(tenant, id);
    if (existing.isSystem) {
      throw AppException.conflict('System prompt templates cannot be deleted');
    }
    await this.prisma.client.promptTemplate.delete({ where: { id: existing.id } });
    await this.audit.log({
      action: AuditAction.PROMPT_TEMPLATE_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'prompt_template',
      targetId: existing.id,
      metadata: { key: existing.key },
      request: meta,
    });
  }

  /** Non-strict rendering: unknown placeholders become empty and are reported in `missing`. */
  async render(
    tenant: TenantContext,
    id: string,
    dto: RenderPromptTemplateRequest,
  ): Promise<RenderedPrompt> {
    const template = await this.requireTemplate(tenant, id);
    return renderPrompt(template.content, dto.variables);
  }

  private async requireTemplate(tenant: TenantContext, id: string): Promise<PromptTemplate> {
    const row = await this.prisma.client.promptTemplate.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('Prompt template');
    return row;
  }
}

export function renderPrompt(
  content: string,
  variables: RenderPromptTemplateRequest['variables'],
): RenderedPrompt {
  const referenced = extractVariables(content);
  const missing = referenced.filter(
    (name) => variables[name] === undefined || variables[name] === null,
  );
  return { rendered: renderTemplate(content, variables, { strict: false }), missing };
}

export function toPromptTemplate(row: PromptTemplate): PromptTemplateDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    key: row.key,
    name: row.name,
    description: row.description,
    content: row.content,
    variables: [...row.variables],
    isSystem: row.isSystem,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
