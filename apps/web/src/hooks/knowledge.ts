'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateKnowledgeBaseRequest,
  Document,
  KnowledgeSearchRequest,
  UpdateKnowledgeBaseRequest,
} from '@hilatech/contracts';
import {
  knowledgeApi,
  keys,
  type ListDocumentsParams,
  type ListKnowledgeBasesParams,
} from '@/lib/api';
import { useActiveOrganizationId } from './queries';

/** How often document lists refresh while at least one document is still being processed. */
export const DOCUMENT_POLL_MS = 2000;

export function isDocumentInFlight(doc: Pick<Document, 'status'>): boolean {
  return doc.status === 'uploaded' || doc.status === 'processing';
}

export function useKnowledgeBases(params: ListKnowledgeBasesParams = {}) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.knowledgeBases(orgId, params),
    queryFn: () => knowledgeApi.bases(params),
    enabled: !!orgId,
    placeholderData: (prev) => prev,
  });
}

export function useKnowledgeBase(id: string | null) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.knowledgeBase(orgId, id ?? ''),
    queryFn: () => knowledgeApi.base(id as string),
    enabled: !!orgId && !!id,
  });
}

export function useCreateKnowledgeBase() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateKnowledgeBaseRequest) => knowledgeApi.createBase(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.knowledgeRoot(orgId) }),
  });
}

export function useUpdateKnowledgeBase() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateKnowledgeBaseRequest }) =>
      knowledgeApi.updateBase(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.knowledgeRoot(orgId) }),
  });
}

export function useDeleteKnowledgeBase() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => knowledgeApi.removeBase(id),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: keys.knowledgeBase(orgId, id) });
      void qc.invalidateQueries({ queryKey: keys.knowledgeRoot(orgId) });
    },
  });
}

/** Documents of a base; polls every 2 s while any document on the page is uploaded/processing. */
export function useKnowledgeDocuments(baseId: string, params: ListDocumentsParams = {}) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.knowledgeDocuments(orgId, baseId, params),
    queryFn: () => knowledgeApi.documents(baseId, params),
    enabled: !!orgId && !!baseId,
    placeholderData: (prev) => prev,
    refetchInterval: (query) =>
      query.state.data?.data.some(isDocumentInFlight) ? DOCUMENT_POLL_MS : false,
  });
}

export function useDocumentChunks(documentId: string | null, params: { page?: number } = {}) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.knowledgeChunks(orgId, documentId ?? '', params),
    queryFn: () => knowledgeApi.chunks(documentId as string, { ...params, pageSize: 20 }),
    enabled: !!orgId && !!documentId,
    placeholderData: (prev) => prev,
  });
}

export function useUploadDocument(baseId: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (file: File) => knowledgeApi.upload(baseId, file),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.knowledgeRoot(orgId) }),
  });
}

export function useReprocessDocument() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => knowledgeApi.reprocess(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.knowledgeRoot(orgId) }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => knowledgeApi.removeDocument(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.knowledgeRoot(orgId) }),
  });
}

export function useKnowledgeSearch() {
  return useMutation({ mutationFn: (body: KnowledgeSearchRequest) => knowledgeApi.search(body) });
}
