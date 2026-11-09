import type {
  KnowledgeSearchHit,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
} from '@hilatech/contracts';

import type { KnowledgeSearcher } from '../tools/builtin/utility';
import type { EmbeddingService } from './embedding-service';
import type { PgVectorStore } from './pgvector-store';

/**
 * End-to-end retrieval: embed the query with the organization's embedding provider, then search
 * pgvector within the organization (and optionally specific knowledge bases). Implements the
 * `KnowledgeSearcher` port used by the `knowledge.search` tool.
 */
export class PgVectorKnowledgeSearcher implements KnowledgeSearcher {
  constructor(
    private readonly embeddings: EmbeddingService,
    private readonly store: PgVectorStore,
  ) {}

  async query(
    organizationId: string,
    request: KnowledgeSearchRequest,
    options: { userId?: string | null; configId?: string | null; model?: string | null } = {},
  ): Promise<KnowledgeSearchResult> {
    const started = Date.now();
    const { vectors, model } = await this.embeddings.embedTexts(organizationId, [request.query], {
      userId: options.userId ?? null,
      configId: options.configId ?? null,
      model: options.model ?? null,
      metadata: { purpose: 'knowledge_search' },
    });
    const embedding = vectors[0] ?? [];
    const hits = await this.store.search({
      organizationId,
      embedding,
      knowledgeBaseIds: request.knowledgeBaseIds,
      limit: request.limit,
      minScore: request.minScore,
      filter: request.filter,
    });
    return { hits: hits.map(stripDistance), model, tookMs: Date.now() - started };
  }

  async search(params: {
    organizationId: string;
    query: string;
    knowledgeBaseIds?: string[];
    limit: number;
  }) {
    const result = await this.query(params.organizationId, {
      query: params.query,
      knowledgeBaseIds: params.knowledgeBaseIds,
      limit: params.limit,
      minScore: 0.2,
    });
    return result.hits.map((h) => ({
      documentId: h.documentId,
      title: h.documentTitle,
      chunk: h.content,
      score: h.score,
    }));
  }
}

function stripDistance(hit: KnowledgeSearchHit & { distance: number }): KnowledgeSearchHit {
  const { distance: _d, ...rest } = hit;
  return rest;
}
