import { type AiProviderConfig } from '@hilatech/database';

import { AiProvidersService } from './ai-providers.service';

/** Unit test with fakes only - no database, no AWS. Covers the Bedrock gating rules. */
function build(bedrockEnabled: boolean) {
  const created: Record<string, unknown>[] = [];
  const row = (data: Record<string, unknown>) =>
    ({
      id: 'c1',
      createdAt: new Date(),
      updatedAt: new Date(),
      keyLast4: null,
      encryptedApiKey: null,
      lastHealthStatus: 'unknown',
      lastHealthCheckAt: null,
      lastHealthError: null,
      ...data,
    }) as unknown as AiProviderConfig;
  const tx = {
    aiProviderConfig: {
      count: async () => 0,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return row(data);
      },
    },
  };
  const prisma = {
    client: {
      aiProviderConfig: { findFirst: async () => null },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
  const audit = { log: async () => undefined };
  const resolver = { encryptApiKey: () => ({ encryptedApiKey: 'x', keyLast4: 'x' }) };
  const config = { get: (key: string) => (key === 'AI_BEDROCK_ENABLED' ? bedrockEnabled : false) };
  const service = new AiProvidersService(
    prisma as never,
    audit as never,
    resolver as never,
    config as never,
    { policy: {} } as never,
  );
  return { service, created };
}

const tenant = { organizationId: 'o1', userId: 'u1' } as never;
const meta = {} as never;

describe('AiProvidersService - bedrock', () => {
  it('refuses bedrock configurations unless AI_BEDROCK_ENABLED=true', async () => {
    const { service } = build(false);
    await expect(
      service.create(
        tenant,
        {
          provider: 'bedrock',
          name: 'AWS',
          defaultModel: 'amazon.nova-micro-v1:0',
          isDefault: false,
          isEnabled: true,
        },
        meta,
      ),
    ).rejects.toThrow(/not enabled/);
    expect(service.listModels('bedrock')).toEqual([]);
    expect(service.listModels().some((m) => m.provider === 'bedrock')).toBe(false);
  });

  it('stores region without any key and ignores a tenant-supplied endpoint', async () => {
    const { service, created } = build(true);
    const dto = await service.create(
      tenant,
      {
        provider: 'bedrock',
        name: 'AWS',
        region: 'eu-west-1',
        baseUrl: 'https://evil.example.com',
        defaultModel: 'amazon.nova-micro-v1:0',
        isDefault: false,
        isEnabled: true,
      },
      meta,
    );
    expect(created[0]).toMatchObject({
      provider: 'bedrock',
      region: 'eu-west-1',
      baseUrl: null,
      encryptedApiKey: null,
    });
    expect(dto).toMatchObject({ region: 'eu-west-1', hasApiKey: false, baseUrl: null });
    expect(service.listModels('bedrock').length).toBeGreaterThan(0);
  });
});
