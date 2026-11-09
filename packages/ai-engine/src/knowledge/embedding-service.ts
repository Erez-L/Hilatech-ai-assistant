import { EMBEDDING_DIMENSIONS } from '@hilatech/contracts';

import { AiNotConfiguredError, AiProviderError } from '../errors';
import type { UsageRecorder } from '../orchestrator/types';
import { findModel } from '../providers/models';
import type { ProviderResolver } from '../persistence/provider-resolver';
import type { EngineLogger } from '../tools/types';
import { noopLogger } from '../tools/types';

export interface EmbedTextsOptions {
  configId?: string | null;
  model?: string | null;
  userId?: string | null;
  signal?: AbortSignal;
  /** Attribution for usage logs. */
  metadata?: Record<string, unknown>;
}

export interface EmbedTextsResult {
  vectors: number[][];
  model: string;
  providerConfigId: string | null;
  inputTokens: number;
}

/** Default embedding model per provider kind when the config has none. */
const DEFAULT_EMBEDDING_MODEL: Record<string, string> = {
  openai: 'text-embedding-3-small',
  mock: 'mock-embedding',
};

/**
 * Produces vectors normalised to EMBEDDING_DIMENSIONS so every organization shares one pgvector index.
 * Models that natively support `dimensions` shrink server-side; others are zero-padded or truncated
 * (truncation is logged — prefer a model with ≤ 1536 dimensions).
 */
export class EmbeddingService {
  constructor(
    private readonly resolver: Pick<ProviderResolver, 'forOrganization'>,
    private readonly usage: UsageRecorder,
    private readonly logger: EngineLogger = noopLogger,
    private readonly batchSize = 64,
  ) {}

  async embedTexts(
    organizationId: string,
    texts: string[],
    options: EmbedTextsOptions = {},
  ): Promise<EmbedTextsResult> {
    if (texts.length === 0)
      return {
        vectors: [],
        model: options.model ?? '',
        providerConfigId: options.configId ?? null,
        inputTokens: 0,
      };
    const resolved = await this.resolver.forOrganization(organizationId, {
      configId: options.configId ?? null,
    });
    const model =
      options.model ??
      resolved.embeddingModel ??
      DEFAULT_EMBEDDING_MODEL[resolved.providerKind] ??
      null;
    if (!model) {
      throw new AiNotConfiguredError(
        `Provider "${resolved.providerKind}" has no embedding model configured`,
      );
    }
    const info = findModel(resolved.providerKind, model);
    if (info && !info.supportsEmbeddings) {
      throw new AiNotConfiguredError(`Model "${model}" does not support embeddings`);
    }

    const vectors: number[][] = [];
    let inputTokens = 0;
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const started = Date.now();
      try {
        const result = await resolved.provider.embed({
          model,
          input: batch,
          dimensions: EMBEDDING_DIMENSIONS,
          signal: options.signal,
        });
        inputTokens += result.usage.inputTokens;
        for (const vector of result.embeddings)
          vectors.push(normaliseDimensions(vector, this.logger, model));
        await this.usage.record({
          organizationId,
          userId: options.userId ?? null,
          agentId: null,
          executionId: null,
          threadId: null,
          provider: resolved.providerKind,
          model,
          operation: 'embed',
          status: 'success',
          usage: { inputTokens: result.usage.inputTokens, outputTokens: 0 },
          durationMs: Date.now() - started,
          metadata: { count: batch.length, ...(options.metadata ?? {}) },
        });
      } catch (error) {
        await this.usage.record({
          organizationId,
          userId: options.userId ?? null,
          agentId: null,
          executionId: null,
          threadId: null,
          provider: resolved.providerKind,
          model,
          operation: 'embed',
          status:
            error instanceof AiProviderError && error.code === 'timeout' ? 'timeout' : 'error',
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: Date.now() - started,
          errorCode: error instanceof AiProviderError ? error.code : 'unknown',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    return { vectors, model, providerConfigId: resolved.providerConfigId, inputTokens };
  }
}

export function normaliseDimensions(
  vector: number[],
  logger: EngineLogger,
  model: string,
): number[] {
  if (vector.length === EMBEDDING_DIMENSIONS) return vector;
  if (vector.length < EMBEDDING_DIMENSIONS) {
    return [...vector, ...new Array<number>(EMBEDDING_DIMENSIONS - vector.length).fill(0)];
  }
  logger.warn(
    { model, dimensions: vector.length },
    `embedding truncated to ${EMBEDDING_DIMENSIONS} dimensions`,
  );
  return vector.slice(0, EMBEDDING_DIMENSIONS);
}

/** pgvector literal: `[0.1,0.2,…]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(8).replace(/\.?0+$/, '') || '0' : '0')).join(',')}]`;
}
