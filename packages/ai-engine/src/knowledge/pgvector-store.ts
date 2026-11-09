import type { KnowledgeSearchHit } from '@hilatech/contracts';
import { Prisma, type PrismaClient } from '@hilatech/database';

import { toVectorLiteral } from './embedding-service';

export interface VectorSearchParams {
  organizationId: string;
  embedding: number[];
  knowledgeBaseIds?: string[];
  limit: number;
  minScore: number;
  /** Exact-match filter on chunk metadata keys. */
  filter?: Record<string, string | number | boolean>;
}

/**
 * Raw-SQL access to the pgvector column on `DocumentChunk` (Prisma cannot read/write `Unsupported`
 * columns). Every statement is organization-scoped. Cosine distance via `<=>`; score = 1 - distance.
 */
export class PgVectorStore {
  constructor(private readonly prisma: PrismaClient) {}

  /** Store embeddings for chunk rows that already exist. */
  async setEmbeddings(
    organizationId: string,
    rows: Array<{ chunkId: string; embedding: number[] }>,
  ): Promise<number> {
    let updated = 0;
    for (const row of rows) {
      const result = await this.prisma.$executeRaw`
        UPDATE "DocumentChunk"
        SET "embedding" = ${toVectorLiteral(row.embedding)}::vector
        WHERE "id" = ${row.chunkId}::uuid AND "organizationId" = ${organizationId}::uuid`;
      updated += Number(result);
    }
    return updated;
  }

  async search(
    params: VectorSearchParams,
  ): Promise<Array<KnowledgeSearchHit & { distance: number }>> {
    const vector = toVectorLiteral(params.embedding);
    const kbFilter =
      params.knowledgeBaseIds && params.knowledgeBaseIds.length > 0
        ? Prisma.sql`AND c."knowledgeBaseId" IN (${Prisma.join(params.knowledgeBaseIds.map((id) => Prisma.sql`${id}::uuid`))})`
        : Prisma.empty;
    const metaFilter =
      params.filter && Object.keys(params.filter).length > 0
        ? Prisma.sql`AND c."metadata" @> ${JSON.stringify(params.filter)}::jsonb`
        : Prisma.empty;
    // Over-fetch a little so the minScore cut still yields `limit` rows when possible.
    const take = Math.min(params.limit * 3, 100);
    const rows = await this.prisma.$queryRaw<
      Array<{
        chunkId: string;
        documentId: string;
        knowledgeBaseId: string;
        documentTitle: string;
        index: number;
        content: string;
        metadata: unknown;
        distance: number;
      }>
    >`
      SELECT c."id" AS "chunkId", c."documentId", c."knowledgeBaseId", d."title" AS "documentTitle",
             c."index", c."content", c."metadata", (c."embedding" <=> ${vector}::vector) AS "distance"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      WHERE c."organizationId" = ${params.organizationId}::uuid
        AND c."embedding" IS NOT NULL
        AND d."status" = 'ready'
        ${kbFilter}
        ${metaFilter}
      ORDER BY c."embedding" <=> ${vector}::vector
      LIMIT ${take}`;
    return rows
      .map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        knowledgeBaseId: r.knowledgeBaseId,
        documentTitle: r.documentTitle,
        index: r.index,
        content: r.content,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        distance: Number(r.distance),
        score: 1 - Number(r.distance),
      }))
      .filter((r) => r.score >= params.minScore)
      .slice(0, params.limit);
  }

  /**
   * Knowledge bases of the organization (optionally only `ids`) with the embedding configuration their
   * vectors were produced with — a query must be embedded with the same provider/model to be comparable.
   */
  async embeddingTargets(
    organizationId: string,
    ids?: string[],
  ): Promise<
    Array<{ id: string; embeddingProviderConfigId: string | null; embeddingModel: string | null }>
  > {
    return this.prisma.knowledgeBase.findMany({
      where: { organizationId, ...(ids && ids.length > 0 ? { id: { in: ids } } : {}) },
      select: { id: true, embeddingProviderConfigId: true, embeddingModel: true },
    });
  }

  /** Count chunks with embeddings for a document (processing progress). */
  async embeddedCount(organizationId: string, documentId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "DocumentChunk"
      WHERE "organizationId" = ${organizationId}::uuid AND "documentId" = ${documentId}::uuid AND "embedding" IS NOT NULL`;
    return Number(rows[0]?.count ?? 0);
  }
}
