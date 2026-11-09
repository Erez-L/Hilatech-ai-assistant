import { type AiProviderConfig } from '@hilatech/database';

import { toAiProviderConfig } from './ai-providers.mappers';

describe('toAiProviderConfig', () => {
  const now = new Date('2026-11-09T10:00:00Z');
  const row = {
    id: 'c1',
    organizationId: 'o1',
    provider: 'openai',
    name: 'OpenAI',
    encryptedApiKey: 'v1.SECRET.CIPHER.TAG',
    keyLast4: 'WXYZ',
    baseUrl: null,
    defaultModel: 'gpt-4o-mini',
    embeddingModel: null,
    isDefault: true,
    isEnabled: true,
    lastHealthStatus: 'unknown',
    lastHealthCheckAt: null,
    lastHealthError: null,
    createdAt: now,
    updatedAt: now,
  } as unknown as AiProviderConfig;

  it('never exposes the encrypted key, only hasApiKey and keyLast4', () => {
    const dto = toAiProviderConfig(row);
    expect(JSON.stringify(dto)).not.toContain('SECRET');
    expect(dto).not.toHaveProperty('encryptedApiKey');
    expect(dto).toMatchObject({ hasApiKey: true, keyLast4: 'WXYZ' });
  });

  it('reports hasApiKey=false without a stored key', () => {
    expect(toAiProviderConfig({ ...row, encryptedApiKey: null, keyLast4: null }).hasApiKey).toBe(
      false,
    );
  });
});
