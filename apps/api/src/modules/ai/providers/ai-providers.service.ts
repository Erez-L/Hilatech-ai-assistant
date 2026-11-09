import {
  AiNotConfiguredError,
  AiProviderError,
  type HealthResult,
  ProviderResolver,
  listModels,
  requiresApiKey,
} from '@hilatech/ai-engine';
import {
  type AiHealthCheckResult,
  type AiModelInfo,
  type AiProviderConfig as AiProviderConfigDto,
  type AiProviderKind,
  AuditAction,
  type CreateAiProviderConfigRequest,
  type UpdateAiProviderConfigRequest,
} from '@hilatech/contracts';
import { type AiProviderConfig, type Prisma } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { type RequestMeta } from '../../../common/request';
import { AppConfig } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { toAiProviderConfig } from './ai-providers.mappers';

@Injectable()
export class AiProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resolver: ProviderResolver,
    private readonly config: AppConfig,
  ) {}

  get mockAllowed(): boolean {
    return this.config.get('AI_ALLOW_MOCK_PROVIDER');
  }

  async list(tenant: TenantContext): Promise<AiProviderConfigDto[]> {
    const rows = await this.prisma.client.aiProviderConfig.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toAiProviderConfig);
  }

  async get(tenant: TenantContext, id: string): Promise<AiProviderConfigDto> {
    return toAiProviderConfig(await this.requireConfig(tenant, id));
  }

  async create(
    tenant: TenantContext,
    dto: CreateAiProviderConfigRequest,
    meta: RequestMeta,
  ): Promise<AiProviderConfigDto> {
    this.assertProviderUsable(dto.provider);
    const needsKey = requiresApiKey(dto.provider);
    if (needsKey && !dto.apiKey) {
      throw AppException.validation('An API key is required for this provider', [
        { path: 'apiKey', message: `Provider "${dto.provider}" requires an API key`, code: 'custom' },
      ]);
    }
    await this.assertNameFree(tenant, dto.name);

    const secret = needsKey && dto.apiKey ? this.encrypt(tenant, dto.apiKey) : null;
    const created = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.aiProviderConfig.count({
        where: { organizationId: tenant.organizationId },
      });
      // The first configuration of an organization becomes the default automatically.
      const isDefault = dto.isDefault || existing === 0;
      if (isDefault) await this.clearDefault(tx, tenant.organizationId);
      return tx.aiProviderConfig.create({
        data: {
          organizationId: tenant.organizationId,
          provider: dto.provider,
          name: dto.name,
          encryptedApiKey: secret?.encryptedApiKey ?? null,
          keyLast4: secret?.keyLast4 ?? null,
          baseUrl: dto.baseUrl ?? null,
          defaultModel: dto.defaultModel,
          embeddingModel: dto.embeddingModel ?? null,
          isDefault,
          isEnabled: dto.isEnabled,
        },
      });
    });

    await this.audit.log({
      action: AuditAction.AI_CONFIG_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'ai_provider_config',
      targetId: created.id,
      metadata: {
        provider: created.provider,
        name: created.name,
        defaultModel: created.defaultModel,
        isDefault: created.isDefault,
        hasApiKey: Boolean(created.encryptedApiKey),
      },
      request: meta,
    });
    return toAiProviderConfig(created);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateAiProviderConfigRequest,
    meta: RequestMeta,
  ): Promise<AiProviderConfigDto> {
    const existing = await this.requireConfig(tenant, id);
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameFree(tenant, dto.name);
    }
    if (dto.apiKey && dto.clearApiKey) {
      throw AppException.validation('Provide either apiKey or clearApiKey, not both', [
        { path: 'clearApiKey', message: 'Cannot clear and set the key at once', code: 'custom' },
      ]);
    }

    const data: Prisma.AiProviderConfigUncheckedUpdateInput = {};
    const changes: string[] = [];
    if (dto.name !== undefined && dto.name !== existing.name) {
      data.name = dto.name;
      changes.push('name');
    }
    if (dto.baseUrl !== undefined && dto.baseUrl !== existing.baseUrl) {
      data.baseUrl = dto.baseUrl;
      changes.push('baseUrl');
    }
    if (dto.defaultModel !== undefined && dto.defaultModel !== existing.defaultModel) {
      data.defaultModel = dto.defaultModel;
      changes.push('defaultModel');
    }
    if (dto.embeddingModel !== undefined && dto.embeddingModel !== existing.embeddingModel) {
      data.embeddingModel = dto.embeddingModel;
      changes.push('embeddingModel');
    }
    if (dto.isEnabled !== undefined && dto.isEnabled !== existing.isEnabled) {
      data.isEnabled = dto.isEnabled;
      changes.push('isEnabled');
    }
    if (dto.apiKey && requiresApiKey(existing.provider)) {
      const secret = this.encrypt(tenant, dto.apiKey);
      data.encryptedApiKey = secret.encryptedApiKey;
      data.keyLast4 = secret.keyLast4;
      changes.push('apiKey');
    } else if (dto.clearApiKey && existing.encryptedApiKey) {
      data.encryptedApiKey = null;
      data.keyLast4 = null;
      changes.push('apiKey');
    }
    const makeDefault = dto.isDefault === true && !existing.isDefault;
    if (dto.isDefault !== undefined && dto.isDefault !== existing.isDefault) {
      data.isDefault = dto.isDefault;
      changes.push('isDefault');
    }
    if (changes.length === 0) return toAiProviderConfig(existing);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (makeDefault) await this.clearDefault(tx, tenant.organizationId);
      return tx.aiProviderConfig.update({ where: { id: existing.id }, data });
    });
    this.resolver.invalidate(existing.id);

    await this.audit.log({
      action: AuditAction.AI_CONFIG_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'ai_provider_config',
      targetId: existing.id,
      metadata: { changes, keyRotated: changes.includes('apiKey') && Boolean(dto.apiKey) },
      request: meta,
    });
    return toAiProviderConfig(updated);
  }

  /**
   * Deleting a configuration that agents still point at is refused (409) — agents are admin-managed
   * and must be re-pointed first. Assistant threads referencing it are detached (FK `SetNull`) and
   * fall back to the organization default on their next message.
   */
  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const existing = await this.requireConfig(tenant, id);
    const agents = await this.prisma.client.agent.count({
      where: { organizationId: tenant.organizationId, providerConfigId: existing.id },
    });
    if (agents > 0) {
      throw AppException.conflict(
        `This provider configuration is used by ${agents} agent(s); re-point them first`,
        { agents },
      );
    }
    await this.prisma.client.aiProviderConfig.delete({ where: { id: existing.id } });
    this.resolver.invalidate(existing.id);
    await this.audit.log({
      action: AuditAction.AI_CONFIG_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'ai_provider_config',
      targetId: existing.id,
      metadata: { provider: existing.provider, name: existing.name },
      request: meta,
    });
  }

  /** Runs the provider's cheap health call and stores the outcome on the configuration. */
  async healthCheck(tenant: TenantContext, id: string): Promise<AiHealthCheckResult> {
    const row = await this.requireConfig(tenant, id);
    const started = Date.now();
    let result: HealthResult;
    try {
      const resolved = this.resolver.fromConfig(row, null);
      result = await resolved.provider.healthCheck(row.defaultModel);
    } catch (error) {
      if (error instanceof AiNotConfiguredError || error instanceof AiProviderError) {
        result = { ok: false, latencyMs: Date.now() - started, error: error.message };
      } else {
        throw error;
      }
    }
    const checkedAt = new Date();
    await this.prisma.client.aiProviderConfig.update({
      where: { id: row.id },
      data: {
        lastHealthStatus: result.ok ? 'ok' : 'error',
        lastHealthCheckAt: checkedAt,
        lastHealthError: result.ok ? null : (result.error ?? 'Health check failed').slice(0, 1000),
      },
    });
    return {
      status: result.ok ? 'ok' : 'error',
      checkedAt: checkedAt.toISOString(),
      latencyMs: Math.max(0, Math.round(result.latencyMs)),
      error: result.ok ? null : (result.error ?? 'Health check failed'),
    };
  }

  /** Static model catalogue; mock models are hidden unless the mock provider is enabled. */
  listModels(provider?: AiProviderKind): AiModelInfo[] {
    if (provider === 'mock' && !this.mockAllowed) return [];
    return listModels(provider).filter((m) => m.provider !== 'mock' || this.mockAllowed);
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private async requireConfig(tenant: TenantContext, id: string): Promise<AiProviderConfig> {
    const row = await this.prisma.client.aiProviderConfig.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('AI provider configuration');
    return row;
  }

  private assertProviderUsable(provider: AiProviderKind): void {
    if (provider === 'mock' && !this.mockAllowed) {
      throw AppException.validation('The mock AI provider is not enabled on this server', [
        {
          path: 'provider',
          message: 'mock is only available when AI_ALLOW_MOCK_PROVIDER=true (never in production)',
          code: 'custom',
        },
      ]);
    }
  }

  private async assertNameFree(tenant: TenantContext, name: string): Promise<void> {
    const clash = await this.prisma.client.aiProviderConfig.findFirst({
      where: { organizationId: tenant.organizationId, name },
      select: { id: true },
    });
    if (clash) throw AppException.conflict(`A provider configuration named "${name}" already exists`);
  }

  private encrypt(tenant: TenantContext, apiKey: string) {
    try {
      return this.resolver.encryptApiKey(tenant.organizationId, apiKey);
    } catch (error) {
      if (error instanceof AiNotConfiguredError) {
        throw AppException.conflict(
          'The server cannot store AI credentials: CREDENTIALS_ENCRYPTION_KEY is not configured',
        );
      }
      throw error;
    }
  }

  private async clearDefault(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
    await tx.aiProviderConfig.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }
}
