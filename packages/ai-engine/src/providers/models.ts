import type { AiModelInfo, AiProviderKind } from '@hilatech/contracts';

/**
 * Static catalogue of models the platform knows how to drive. Organizations may still type any
 * model id their provider supports — the catalogue powers the UI picker and capability checks.
 * Context windows are documented upper bounds, not billing data.
 */
const CATALOGUE: AiModelInfo[] = [
  // Anthropic
  model('anthropic', 'claude-sonnet-4-5', 'Claude Sonnet 4.5', 200_000, 64_000, {
    tools: true,
    structured: true,
  }),
  model('anthropic', 'claude-opus-4-1', 'Claude Opus 4.1', 200_000, 32_000, {
    tools: true,
    structured: true,
  }),
  model('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5', 200_000, 64_000, {
    tools: true,
    structured: true,
  }),
  // OpenAI
  model('openai', 'gpt-4.1', 'GPT-4.1', 1_000_000, 32_768, { tools: true, structured: true }),
  model('openai', 'gpt-4.1-mini', 'GPT-4.1 mini', 1_000_000, 32_768, {
    tools: true,
    structured: true,
  }),
  model('openai', 'gpt-4o', 'GPT-4o', 128_000, 16_384, { tools: true, structured: true }),
  model('openai', 'gpt-4o-mini', 'GPT-4o mini', 128_000, 16_384, { tools: true, structured: true }),
  model('openai', 'text-embedding-3-small', 'Text Embedding 3 small', null, null, {
    embeddings: true,
  }),
  model('openai', 'text-embedding-3-large', 'Text Embedding 3 large', null, null, {
    embeddings: true,
  }),
  // Mock (tests / local development only)
  model('mock', 'mock-chat', 'Mock chat model', 32_000, 4_096, { tools: true, structured: true }),
  model('mock', 'mock-embedding', 'Mock embedding model', null, null, { embeddings: true }),
];

function model(
  provider: AiProviderKind,
  id: string,
  displayName: string,
  contextWindow: number | null,
  maxOutputTokens: number | null,
  caps: { tools?: boolean; structured?: boolean; embeddings?: boolean },
): AiModelInfo {
  return {
    id,
    provider,
    displayName,
    contextWindow,
    maxOutputTokens,
    supportsTools: caps.tools ?? false,
    supportsStreaming: !caps.embeddings,
    supportsStructuredOutput: caps.structured ?? false,
    supportsEmbeddings: caps.embeddings ?? false,
  };
}

export function listModels(provider?: AiProviderKind): AiModelInfo[] {
  return provider ? CATALOGUE.filter((m) => m.provider === provider) : [...CATALOGUE];
}

export function findModel(provider: AiProviderKind, id: string): AiModelInfo | undefined {
  return CATALOGUE.find((m) => m.provider === provider && m.id === id);
}

/** Context window used for budgeting when the model is unknown to the catalogue. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

export function contextWindowFor(provider: AiProviderKind, id: string): number {
  return findModel(provider, id)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}
