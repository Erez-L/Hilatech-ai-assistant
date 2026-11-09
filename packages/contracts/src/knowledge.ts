import { z } from 'zod';
import { idSchema, paginationQuerySchema, sortOrderSchema, timestampsSchema } from './common';

// ---------------------------------------------------------------------------
// Knowledge bases
// ---------------------------------------------------------------------------

/** All stored vectors are normalised to this many dimensions (OpenAI `dimensions` param / zero padding). */
export const EMBEDDING_DIMENSIONS = 1536;

export const knowledgeBaseSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    name: z.string(),
    description: z.string().nullable(),
    embeddingProviderConfigId: idSchema.nullable(),
    embeddingModel: z.string().nullable(),
    documentCount: z.number().int().nonnegative(),
    chunkCount: z.number().int().nonnegative(),
    createdById: idSchema.nullable(),
  })
  .merge(timestampsSchema);
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

export const createKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  /** Provider config used for embeddings; must support embeddings (OpenAI or mock). Defaults to the org default. */
  embeddingProviderConfigId: idSchema.optional(),
  embeddingModel: z.string().trim().max(120).optional(),
});
export type CreateKnowledgeBaseRequest = z.infer<typeof createKnowledgeBaseSchema>;
export const updateKnowledgeBaseSchema = createKnowledgeBaseSchema
  .pick({ name: true, description: true })
  .partial();
export type UpdateKnowledgeBaseRequest = z.infer<typeof updateKnowledgeBaseSchema>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DocumentStatus = z.enum(['uploaded', 'processing', 'ready', 'failed']);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

/** Upload formats the processing pipeline can extract text from. */
export const SUPPORTED_DOCUMENT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/pdf',
] as const;

/** Accepted file extensions and the MIME type each one maps to (used to validate and to infer the type). */
export const DOCUMENT_EXTENSION_MIME: Readonly<
  Record<string, (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number]>
> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
};

export const documentSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    knowledgeBaseId: idSchema,
    title: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    status: DocumentStatus,
    error: z.string().nullable(),
    pageCount: z.number().int().nullable(),
    chunkCount: z.number().int().nonnegative(),
    metadata: z.record(z.string(), z.unknown()),
    uploadedById: idSchema.nullable(),
    processedAt: z.string().datetime().nullable(),
  })
  .merge(timestampsSchema);
export type Document = z.infer<typeof documentSchema>;

/** Multipart upload: file field `file`, optional `title`. */
export const uploadDocumentFieldsSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
});
export type UploadDocumentFields = z.infer<typeof uploadDocumentFieldsSchema>;

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: DocumentStatus.optional(),
  sortBy: z.enum(['createdAt', 'title', 'sizeBytes', 'status']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

export const documentChunkSchema = z.object({
  id: idSchema,
  documentId: idSchema,
  index: z.number().int().nonnegative(),
  content: z.string(),
  tokenCount: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()),
});
export type DocumentChunk = z.infer<typeof documentChunkSchema>;

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export const knowledgeSearchSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  /** Restrict to specific knowledge bases of the organization; default: all. */
  knowledgeBaseIds: z.array(idSchema).max(20).optional(),
  limit: z.number().int().min(1).max(20).default(5),
  /** Cosine similarity threshold 0..1; results below are dropped. */
  minScore: z.number().min(0).max(1).default(0.2),
  /** Optional metadata filter (exact match on chunk/document metadata keys). */
  filter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type KnowledgeSearchRequest = z.infer<typeof knowledgeSearchSchema>;

export const knowledgeSearchHitSchema = z.object({
  chunkId: idSchema,
  documentId: idSchema,
  knowledgeBaseId: idSchema,
  documentTitle: z.string(),
  index: z.number().int().nonnegative(),
  content: z.string(),
  score: z.number(),
  metadata: z.record(z.string(), z.unknown()),
});
export type KnowledgeSearchHit = z.infer<typeof knowledgeSearchHitSchema>;

export const knowledgeSearchResultSchema = z.object({
  hits: z.array(knowledgeSearchHitSchema),
  /** Embedding model used for the query. */
  model: z.string(),
  tookMs: z.number().int().nonnegative(),
});
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>;
