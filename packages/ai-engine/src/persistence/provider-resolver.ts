import type { AiProviderKind } from '@hilatech/contracts';
import type { AiProviderConfig, PrismaClient } from '@hilatech/database';
import { SecretBox } from '@hilatech/shared';

import { AiNotConfiguredError } from '../errors';
import type { AgentDefinition, ResolvedModel } from '../orchestrator/types';
import { createProvider, requiresApiKey, type CreateProviderOptions } from '../providers/factory';
import { contextWindowFor } from '../providers/models';
import type { AiProvider } from '../providers/types';

export interface ProviderResolverOptions {
  /** Base64 32-byte key (CREDENTIALS_ENCRYPTION_KEY). Required to decrypt stored provider keys. */
  encryptionKey: string | undefined;
  providerOptions?: CreateProviderOptions;
  /** Per-call provider timeout. */
  timeoutMs?: number;
}

export interface ResolveOptions {
  configId?: string | null;
  model?: string | null;
}

/**
 * Turns an organization's stored provider configuration into a ready adapter. Adapters are cached per
 * config version (`id:updatedAt`) so key rotation or edits invalidate the cache automatically.
 * API keys are decrypted here and nowhere else.
 */
export class ProviderResolver {
  private readonly cache = new Map<string, AiProvider>();
  private readonly secretBox: SecretBox | null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: ProviderResolverOptions,
  ) {
    this.secretBox = options.encryptionKey ? new SecretBox(options.encryptionKey) : null;
  }

  /** Encrypt a key for storage, bound to the organization so envelopes cannot be moved between tenants. */
  encryptApiKey(
    organizationId: string,
    apiKey: string,
  ): { encryptedApiKey: string; keyLast4: string } {
    if (!this.secretBox)
      throw new AiNotConfiguredError('CREDENTIALS_ENCRYPTION_KEY is not configured on the server');
    return {
      encryptedApiKey: this.secretBox.encrypt(apiKey, organizationId),
      keyLast4: SecretBox.last(apiKey),
    };
  }

  /** Resolve for an organization: explicit config id, otherwise the default enabled config. */
  async forOrganization(
    organizationId: string,
    resolve: ResolveOptions = {},
  ): Promise<ResolvedModel> {
    const config = resolve.configId
      ? await this.prisma.aiProviderConfig.findFirst({
          where: { id: resolve.configId, organizationId },
        })
      : ((await this.prisma.aiProviderConfig.findFirst({
          where: { organizationId, isDefault: true, isEnabled: true },
        })) ??
        (await this.prisma.aiProviderConfig.findFirst({
          where: { organizationId, isEnabled: true },
          orderBy: { createdAt: 'asc' },
        })));
    if (!config) throw new AiNotConfiguredError();
    if (!config.isEnabled)
      throw new AiNotConfiguredError(`AI provider configuration "${config.name}" is disabled`);
    return this.fromConfig(config, resolve.model ?? null);
  }

  async forAgent(agent: AgentDefinition): Promise<ResolvedModel> {
    return this.forOrganization(agent.organizationId, {
      configId: agent.providerConfigId,
      model: agent.model,
    });
  }

  /** Build (or reuse) the adapter for a config row. */
  fromConfig(config: AiProviderConfig, modelOverride: string | null): ResolvedModel {
    const provider = this.adapterFor(config);
    const model = modelOverride ?? config.defaultModel;
    return {
      provider,
      providerKind: config.provider,
      providerConfigId: config.id,
      model,
      contextWindow: contextWindowFor(config.provider, model),
      embeddingModel: config.embeddingModel,
    };
  }

  /** Adapter for ad-hoc credentials (health check before saving a new key). */
  adapterForCredentials(
    kind: AiProviderKind,
    apiKey: string | undefined,
    baseUrl: string | null | undefined,
    region?: string | null,
  ): AiProvider {
    return createProvider(
      kind,
      {
        apiKey,
        baseUrl: baseUrl ?? undefined,
        region: region ?? undefined,
        timeoutMs: this.options.timeoutMs,
      },
      this.options.providerOptions,
    );
  }

  private adapterFor(config: AiProviderConfig): AiProvider {
    const cacheKey = `${config.id}:${config.updatedAt.toISOString()}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    let apiKey: string | undefined;
    if (requiresApiKey(config.provider)) {
      if (!config.encryptedApiKey)
        throw new AiNotConfiguredError(`AI provider configuration "${config.name}" has no API key`);
      if (!this.secretBox)
        throw new AiNotConfiguredError(
          'CREDENTIALS_ENCRYPTION_KEY is not configured on the server',
        );
      apiKey = this.secretBox.decrypt(config.encryptedApiKey, config.organizationId);
    }
    const adapter = createProvider(
      config.provider,
      {
        apiKey,
        baseUrl: config.baseUrl ?? undefined,
        region: config.region ?? undefined,
        timeoutMs: this.options.timeoutMs,
      },
      this.options.providerOptions,
    );
    // Drop stale versions of the same config.
    for (const key of this.cache.keys())
      if (key.startsWith(`${config.id}:`)) this.cache.delete(key);
    this.cache.set(cacheKey, adapter);
    return adapter;
  }

  invalidate(configId: string): void {
    for (const key of this.cache.keys()) if (key.startsWith(`${configId}:`)) this.cache.delete(key);
  }
}
