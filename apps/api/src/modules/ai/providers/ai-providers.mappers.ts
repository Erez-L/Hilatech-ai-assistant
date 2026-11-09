import { type AiProviderConfig as AiProviderConfigDto } from '@hilatech/contracts';
import { type AiProviderConfig } from '@hilatech/database';

import { isoOrNull } from '../../crm/crm.mappers';

/** Serialises a provider configuration for clients. The encrypted key never leaves this function. */
export function toAiProviderConfig(row: AiProviderConfig): AiProviderConfigDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    name: row.name,
    keyLast4: row.keyLast4,
    hasApiKey: Boolean(row.encryptedApiKey),
    baseUrl: row.baseUrl,
    region: row.region,
    defaultModel: row.defaultModel,
    embeddingModel: row.embeddingModel,
    isDefault: row.isDefault,
    isEnabled: row.isEnabled,
    lastHealthStatus: row.lastHealthStatus,
    lastHealthCheckAt: isoOrNull(row.lastHealthCheckAt),
    lastHealthError: row.lastHealthError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
