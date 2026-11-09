import type {
  CreateKnowledgeBaseRequest,
  Document,
  DocumentChunk,
  DocumentStatus,
  KnowledgeBase,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
  PaginationQuery,
  UpdateKnowledgeBaseRequest,
} from '@hilatech/contracts';
import { api } from './client';

const enc = encodeURIComponent;

export interface ListKnowledgeBasesParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface ListDocumentsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: DocumentStatus;
  sortBy?: 'createdAt' | 'title' | 'sizeBytes' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export const knowledgeApi = {
  bases: (q: ListKnowledgeBasesParams = {}) =>
    api.list<KnowledgeBase>('/knowledge/bases', {
      page: q.page,
      pageSize: q.pageSize,
      search: q.search,
    }),
  base: (id: string) => api.get<KnowledgeBase>(`/knowledge/bases/${enc(id)}`),
  createBase: (body: CreateKnowledgeBaseRequest) =>
    api.post<KnowledgeBase>('/knowledge/bases', body),
  updateBase: (id: string, body: UpdateKnowledgeBaseRequest) =>
    api.patch<KnowledgeBase>(`/knowledge/bases/${enc(id)}`, body),
  removeBase: (id: string) => api.delete<void>(`/knowledge/bases/${enc(id)}`),

  documents: (baseId: string, q: ListDocumentsParams = {}) =>
    api.list<Document>(`/knowledge/bases/${enc(baseId)}/documents`, {
      page: q.page,
      pageSize: q.pageSize,
      search: q.search,
      status: q.status,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
    }),
  /** Multipart upload: file field `file`, optional `title`. */
  upload: (baseId: string, file: File, title?: string) => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (title) form.append('title', title);
    return api.post<Document>(`/knowledge/bases/${enc(baseId)}/documents`, form);
  },
  document: (id: string) => api.get<Document>(`/knowledge/documents/${enc(id)}`),
  chunks: (id: string, q: Partial<PaginationQuery> = {}) =>
    api.list<DocumentChunk>(`/knowledge/documents/${enc(id)}/chunks`, {
      page: q.page,
      pageSize: q.pageSize,
    }),
  reprocess: (id: string) => api.post<Document>(`/knowledge/documents/${enc(id)}/reprocess`),
  removeDocument: (id: string) => api.delete<void>(`/knowledge/documents/${enc(id)}`),
  /** Authenticated download: returns the file as a Blob (the endpoint needs the bearer token). */
  download: async (id: string): Promise<Blob> => {
    const res = await api.fetchRaw(`/knowledge/documents/${enc(id)}/download`);
    return res.blob();
  },
  search: (body: KnowledgeSearchRequest) =>
    api.post<KnowledgeSearchResult>('/knowledge/search', body),
};
