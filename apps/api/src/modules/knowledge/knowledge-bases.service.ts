import { AiNotConfiguredError, ProviderResolver, findModel } from '@hilatech/ai-engine';
import {
  AuditAction,
  type CreateKnowledgeBaseRequest,
  type KnowledgeBase as KnowledgeBaseDto,
  type PaginationQuery,
  type UpdateKnowledgeBaseRequest,
} from '@hilatech/contracts';
import { type KnowledgeBase, Prisma } from '@hilatech/database';
import { type StorageDriver } from '@hilatech/storage';
import { type TenantContext } from '@hilatech/types';
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { STORAGE_DRIVER } from '../../infrastructure/storage/storage.module';
import { withEngineErrors } from '../ai/core/ai-errors';
import { AuditService } from '../audit/audit.service';
import { toKnowledgeBase } from './knowledge.mappers';

/** Provider kinds whose models can produce embeddings. */
const EMBEDDING_PROVIDER_KINDS = ['openai', 'mock'] as const;

@Injectable()
export class KnowledgeBasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resolver: ProviderResolver,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly logger: Logger,
  ) {}

  async list(
    tenant: TenantContext,
    query: PaginationQuery & { search?: string },
  ): Promise<PageResult<KnowledgeBaseDto>> {
    const where: Prisma.KnowledgeBaseWhereInput = {
      organizationId: tenant.organizationId,
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
      this.prisma.client.knowledgeBase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.knowledgeBase.count({ where }),
    ]);
    return page(rows.map(toKnowledgeBase), query, total);
  }

  async get(tenant: TenantContext, id: string): Promise<KnowledgeBaseDto> {
    return toKnowledgeBase(await this.require(tenant, id));
  }

  /** Organization-scoped lookup; foreign or unknown ids are a 404. */
  async require(tenant: TenantContext, id: string): Promise<KnowledgeBase> {
    const row = await this.prisma.client.knowledgeBase.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('Knowledge base');
    return row;
  }

  async create(
    tenant: TenantContext,
    dto: CreateKnowledgeBaseRequest,
    meta: RequestMeta,
  ): Promise<KnowledgeBaseDto> {
    await this.assertNameAvailable(tenant, dto.name);
    const { configId, model } = await this.resolveEmbeddingTarget(tenant, dto);
    try {
      const row = await this.prisma.client.knowledgeBase.create({
        data: {
          organizationId: tenant.organizationId,
          name: dto.name,
          description: dto.description ?? null,
          embeddingProviderConfigId: configId,
          embeddingModel: model,
          createdById: tenant.userId,
        },
      });
      await this.audit.log({
        action: AuditAction.KNOWLEDGE_BASE_CREATED,
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        targetType: 'knowledge_base',
        targetId: row.id,
        metadata: { name: row.name, embeddingProviderConfigId: configId, embeddingModel: model },
        request: meta,
      });
      return toKnowledgeBase(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppException.conflict('A knowledge base with this name already exists');
      }
      throw error;
    }
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateKnowledgeBaseRequest,
    meta: RequestMeta,
  ): Promise<KnowledgeBaseDto> {
    const existing = await this.require(tenant, id);
    const data: Prisma.KnowledgeBaseUncheckedUpdateInput = {};
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(tenant, dto.name, id);
      data.name = dto.name;
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (Object.keys(data).length === 0) return toKnowledgeBase(existing);
    const row = await this.prisma.client.knowledgeBase.update({ where: { id }, data });
    await this.audit.log({
      action: AuditAction.KNOWLEDGE_BASE_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'knowledge_base',
      targetId: id,
      metadata: { changes: Object.keys(data) },
      request: meta,
    });
    return toKnowledgeBase(row);
  }

  /** Deletes the base, its documents and chunks (cascade) and the stored files (best effort). */
  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const existing = await this.require(tenant, id);
    const documents = await this.prisma.client.document.findMany({
      where: { knowledgeBaseId: id, organizationId: tenant.organizationId },
      select: { storageKey: true },
    });
    await this.prisma.client.knowledgeBase.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    for (const { storageKey } of documents) {
      await this.storage.delete(storageKey).catch((error: unknown) => {
        this.logger.warn(
          { err: error, storageKey },
          'Could not delete stored file',
          KnowledgeBasesService.name,
        );
      });
    }
    await this.audit.log({
      action: AuditAction.KNOWLEDGE_BASE_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'knowledge_base',
      targetId: id,
      metadata: { name: existing.name, documents: documents.length },
      request: meta,
    });
  }

  private async assertNameAvailable(
    tenant: TenantContext,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.client.knowledgeBase.findFirst({
      where: {
        organizationId: tenant.organizationId,
        name,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw AppException.conflict('A knowledge base with this name already exists');
  }

  /**
   * Which provider config/model indexes this base. An explicit config must belong to the organization,
   * be enabled and be embedding-capable; otherwise the first embedding-capable enabled config is pinned
   * (so later changes of the organization default cannot silently mix vector spaces).
   */
  private async resolveEmbeddingTarget(
    tenant: TenantContext,
    dto: CreateKnowledgeBaseRequest,
  ): Promise<{ configId: string | null; model: string | null }> {
    if (dto.embeddingProviderConfigId) {
      const config = await this.prisma.client.aiProviderConfig.findFirst({
        where: { id: dto.embeddingProviderConfigId, organizationId: tenant.organizationId },
      });
      if (!config) throw AppException.notFound('AI provider configuration');
      if (!config.isEnabled) {
        throw AppException.validation('The selected AI provider configuration is disabled');
      }
      if (!(EMBEDDING_PROVIDER_KINDS as readonly string[]).includes(config.provider)) {
        throw AppException.validation(
          `Provider "${config.provider}" does not support embeddings (use openai)`,
        );
      }
      this.assertEmbeddingModel(config.provider, dto.embeddingModel ?? config.embeddingModel);
      return { configId: config.id, model: dto.embeddingModel ?? null };
    }
    const configs = await this.prisma.client.aiProviderConfig.findMany({
      where: {
        organizationId: tenant.organizationId,
        isEnabled: true,
        provider: { in: [...EMBEDDING_PROVIDER_KINDS] },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      take: 1,
    });
    const config = configs[0];
    if (dto.embeddingModel) {
      if (!config) {
        throw AppException.validation('An embedding model needs an embedding-capable AI provider');
      }
      this.assertEmbeddingModel(config.provider, dto.embeddingModel);
    }
    return { configId: config?.id ?? null, model: dto.embeddingModel ?? null };
  }

  private assertEmbeddingModel(provider: string, model: string | null | undefined): void {
    if (!model) return;
    const info = findModel(provider as 'openai' | 'mock', model);
    if (info && !info.supportsEmbeddings) {
      throw AppException.validation(`Model "${model}" does not support embeddings`);
    }
  }

  /** Throws `409 AI_NOT_CONFIGURED` when documents of this base could not be embedded. */
  async assertEmbeddingsAvailable(
    tenant: TenantContext,
    base: Pick<KnowledgeBase, 'embeddingProviderConfigId' | 'embeddingModel'>,
  ): Promise<void> {
    await withEngineErrors(async () => {
      const resolved = await this.resolver.forOrganization(tenant.organizationId, {
        configId: base.embeddingProviderConfigId,
      });
      const model = base.embeddingModel ?? resolved.embeddingModel;
      const capable =
        (EMBEDDING_PROVIDER_KINDS as readonly string[]).includes(resolved.providerKind) || model;
      if (!capable) {
        throw new AiNotConfiguredError(
          `The AI provider "${resolved.providerKind}" has no embedding model; configure an OpenAI provider for knowledge bases`,
        );
      }
    });
  }
}
