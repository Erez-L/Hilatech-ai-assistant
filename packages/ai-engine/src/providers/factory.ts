import type { AiProviderKind } from '@hilatech/contracts';

import { AiProviderError } from '../errors';
import { AnthropicProvider } from './anthropic';
import { MockProvider, type MockProviderOptions } from './mock';
import { OpenAiProvider } from './openai';
import type { AiProvider, ProviderCredentials } from './types';

export interface CreateProviderOptions {
  /** `production` refuses the mock provider. */
  nodeEnv?: string;
  /** Explicit opt-in required for mock outside tests (e.g. AI_ALLOW_MOCK_PROVIDER=true). */
  allowMock?: boolean;
  mock?: MockProviderOptions;
}

/** Build a provider adapter from a kind + credentials. The only place SDK adapters are instantiated. */
export function createProvider(
  kind: AiProviderKind,
  credentials: ProviderCredentials,
  options: CreateProviderOptions = {},
): AiProvider {
  switch (kind) {
    case 'anthropic':
      return new AnthropicProvider(credentials);
    case 'openai':
      return new OpenAiProvider(credentials);
    case 'mock': {
      const env = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
      const allowed =
        options.allowMock ?? (env === 'test' || process.env.AI_ALLOW_MOCK_PROVIDER === 'true');
      if (env === 'production' || !allowed) {
        throw new AiProviderError({
          provider: 'mock',
          code: 'unsupported',
          message:
            'The mock AI provider is only available in test/development with AI_ALLOW_MOCK_PROVIDER=true',
          retryable: false,
        });
      }
      return new MockProvider(options.mock);
    }
    default: {
      const never: never = kind;
      throw new AiProviderError({
        provider: String(never),
        code: 'unsupported',
        message: `Unknown provider ${String(never)}`,
        retryable: false,
      });
    }
  }
}

/** Providers that need an API key to be usable. */
export function requiresApiKey(kind: AiProviderKind): boolean {
  return kind !== 'mock';
}
