import {
  type Document as DocumentDto,
  type DocumentChunk as DocumentChunkDto,
  type KnowledgeBase as KnowledgeBaseDto,
} from '@hilatech/contracts';
import { type Document, type DocumentChunk, type KnowledgeBase } from '@hilatech/database';

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toKnowledgeBase(row: KnowledgeBase): KnowledgeBaseDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    embeddingProviderConfigId: row.embeddingProviderConfigId,
    embeddingModel: row.embeddingModel,
    documentCount: row.documentCount,
    chunkCount: row.chunkCount,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Never exposes `storageKey` or `checksum`: files are only reachable through the download endpoint. */
export function toDocument(row: Document): DocumentDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    knowledgeBaseId: row.knowledgeBaseId,
    title: row.title,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error,
    pageCount: row.pageCount,
    chunkCount: row.chunkCount,
    metadata: jsonObject(row.metadata),
    uploadedById: row.uploadedById,
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDocumentChunk(
  row: Pick<DocumentChunk, 'id' | 'documentId' | 'index' | 'content' | 'tokenCount' | 'metadata'>,
): DocumentChunkDto {
  return {
    id: row.id,
    documentId: row.documentId,
    index: row.index,
    content: row.content,
    tokenCount: row.tokenCount,
    metadata: jsonObject(row.metadata),
  };
}
