import type {
  KnowledgeSearchHit,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
} from '@hilatech/contracts';

import type { KnowledgeSearcher, KnowledgeSearchPassage } from '../tools/builtin/utility';
import type { EmbeddingService } from './embedding-service';
import type { PgVectorStore } from './pgvector-store';

/**
 * End-to-end retrieval: embed the query with the embedding provider each knowledge base was indexed with
 * (organization default when the base has none), then search pgvector within the organization (and
 * optionally specific knowledge bases). Bases indexed with different providers/models are queried
 * separately — vectors from different models are not comparable — and merged by score. Implements the
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
    options: { userId?: string | null } = {},
  ): Promise<KnowledgeSearchResult> {
    const started = Date.now();
    const targets = await this.store.embeddingTargets(organizationId, request.knowledgeBaseIds);
    if (targets.length === 0) return { hits: [], model: '', tookMs: Date.now() - started };

    const groups = new Map<
      string,
      { configId: string | null; model: string | null; ids: string[] }
    >();
    for (const target of targets) {
      const key = `${target.embeddingProviderConfigId ?? ''}|${target.embeddingModel ?? ''}`;
      const group = groups.get(key) ?? {
        configId: target.embeddingProviderConfigId,
        model: target.embeddingModel,
        ids: [],
      };
      group.ids.push(target.id);
      groups.set(key, group);
    }

    const hits: Array<KnowledgeSearchHit & { distance: number }> = [];
    let usedModel = '';
    for (const group of groups.values()) {
      const { vectors, model } = await this.embeddings.embedTexts(organizationId, [request.query], {
        userId: options.userId ?? null,
        configId: group.configId,
        model: group.model,
        metadata: { purpose: 'knowledge_search' },
      });
      usedModel ||= model;
      hits.push(
        ...(await this.store.search({
          organizationId,
          embedding: vectors[0] ?? [],
          knowledgeBaseIds: group.ids,
          limit: request.limit,
          minScore: request.minScore,
          filter: request.filter,
        })),
      );
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      hits: hits.slice(0, request.limit).map(stripDistance),
      model: usedModel,
      tookMs: Date.now() - started,
    };
  }

  async search(params: {
    organizationId: string;
    userId?: string | null;
    query: string;
    knowledgeBaseIds?: string[];
    limit: number;
  }): Promise<KnowledgeSearchPassage[]> {
    const result = await this.query(
      params.organizationId,
      {
        query: params.query,
        knowledgeBaseIds: params.knowledgeBaseIds,
        limit: params.limit,
        minScore: 0.2,
      },
      { userId: params.userId ?? null },
    );
    return result.hits.map((h) => ({
      documentId: h.documentId,
      knowledgeBaseId: h.knowledgeBaseId,
      title: h.documentTitle,
      chunkIndex: h.index,
      chunk: h.content,
      score: h.score,
    }));
  }
}

function stripDistance(hit: KnowledgeSearchHit & { distance: number }): KnowledgeSearchHit {
  const { distance: _d, ...rest } = hit;
  return rest;
}
