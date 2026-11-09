import type { AiModelInfo, AiProviderKind } from '@hilatech/contracts';

/**
 * Static catalogue of models the platform knows how to drive. Organizations may still type any
 * model id their provider supports — the catalogue powers the UI picker and capability checks.
 * Context windows are documented upper bounds, not billing data.
 */
/** Shown in the UI for every Bedrock entry: the catalogue is static and was never checked against a live account. */
export const BEDROCK_AVAILABILITY_NOTE = 'unverified availability - check your region';

/** Cheapest catalogue chat model, used by the Bedrock health check when no model is given. */
export const DEFAULT_BEDROCK_HEALTH_MODEL = 'amazon.nova-micro-v1:0';

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
  // Amazon Bedrock. NOT VERIFIED against a live account: ids and regional availability must be checked in
  // your region (`aws bedrock list-foundation-models` / `list-inference-profiles`). Newer Claude models are
  // typically invoked through an inference-profile id (e.g. `global.` / `us.` / `eu.` prefix) - confirm yours.
  bedrockModel('amazon.nova-pro-v1:0', 'Amazon Nova Pro', 300_000, 5_120, { tools: true }),
  bedrockModel('amazon.nova-lite-v1:0', 'Amazon Nova Lite', 300_000, 5_120, { tools: true }),
  bedrockModel('amazon.nova-micro-v1:0', 'Amazon Nova Micro', 128_000, 5_120, { tools: true }),
  bedrockModel(
    'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'Claude Sonnet 4.5 (Bedrock, global profile)',
    200_000,
    64_000,
    { tools: true },
  ),
  bedrockModel(
    'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    'Claude Haiku 4.5 (Bedrock, global profile)',
    200_000,
    64_000,
    { tools: true },
  ),
  bedrockModel('amazon.titan-embed-text-v2:0', 'Amazon Titan Text Embeddings V2', null, null, {
    embeddings: true,
  }),
  bedrockModel('cohere.embed-english-v3', 'Cohere Embed English v3', null, null, {
    embeddings: true,
  }),
  bedrockModel('cohere.embed-multilingual-v3', 'Cohere Embed Multilingual v3', null, null, {
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

function bedrockModel(
  id: string,
  displayName: string,
  contextWindow: number | null,
  maxOutputTokens: number | null,
  caps: { tools?: boolean; embeddings?: boolean },
): AiModelInfo {
  return {
    ...model('bedrock', id, displayName, contextWindow, maxOutputTokens, {
      tools: caps.tools,
      // Structured output is implemented through forced tool calls, so it follows tool support.
      structured: caps.tools,
      embeddings: caps.embeddings,
    }),
    availabilityNote: BEDROCK_AVAILABILITY_NOTE,
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
