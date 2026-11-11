import type {
  BoardQuery,
  CreateDealNoteRequest,
  CreateDealRequest,
  CreatePipelineRequest,
  CreateStageRequest,
  DealActivityWithActor,
  DealBoard,
  DealConversionQuery,
  DealConversionReport,
  DealNoteWithAuthor,
  DealWithRelations,
  ListDealsQuery,
  MoveDealRequest,
  PaginationQuery,
  Pipeline,
  UpdateDealRequest,
  UpdatePipelineRequest,
  UpdateStageRequest,
} from '@hilatech/contracts';
import { api } from './client';

export type ListDealsParams = Partial<ListDealsQuery>;
export type BoardParams = Partial<Pick<BoardQuery, 'pipelineId' | 'ownerId' | 'search'>> & {
  limitPerColumn?: number;
  includeClosed?: boolean;
};
const enc = encodeURIComponent;

export const dealsApi = {
  list: (query: ListDealsParams = {}) =>
    api.list<DealWithRelations>('/deals', {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      pipelineId: query.pipelineId,
      stageId: query.stageId,
      status: query.status,
      ownerId: query.ownerId,
      contactId: query.contactId,
      companyId: query.companyId,
      tag: query.tag,
      minValue: query.minValue,
      maxValue: query.maxValue,
      expectedCloseFrom: query.expectedCloseFrom,
      expectedCloseTo: query.expectedCloseTo,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  board: (query: BoardParams = {}) => api.get<DealBoard>('/deals/board', { query: { ...query } }),
  conversion: (query: Partial<DealConversionQuery> = {}) =>
    api.get<DealConversionReport>('/deals/reports/conversion', { query: { ...query } }),
  get: (id: string) => api.get<DealWithRelations>(`/deals/${enc(id)}`),
  create: (body: CreateDealRequest) => api.post<DealWithRelations>('/deals', body),
  update: (id: string, body: UpdateDealRequest) =>
    api.patch<DealWithRelations>(`/deals/${enc(id)}`, body),
  remove: (id: string) => api.delete<void>(`/deals/${enc(id)}`),
  move: (id: string, body: MoveDealRequest) =>
    api.post<DealWithRelations>(`/deals/${enc(id)}/move`, body),
  notes: (id: string, query: Partial<PaginationQuery> = {}) =>
    api.list<DealNoteWithAuthor>(`/deals/${enc(id)}/notes`, {
      page: query.page,
      pageSize: query.pageSize,
    }),
  addNote: (id: string, body: CreateDealNoteRequest) =>
    api.post<DealNoteWithAuthor>(`/deals/${enc(id)}/notes`, body),
  removeNote: (id: string, noteId: string) =>
    api.delete<void>(`/deals/${enc(id)}/notes/${enc(noteId)}`),
  activities: (id: string, query: Partial<PaginationQuery> = {}) =>
    api.list<DealActivityWithActor>(`/deals/${enc(id)}/activities`, {
      page: query.page,
      pageSize: query.pageSize,
    }),
};

export const pipelinesApi = {
  list: () => api.get<Pipeline[]>('/pipelines'),
  get: (id: string) => api.get<Pipeline>(`/pipelines/${enc(id)}`),
  create: (body: CreatePipelineRequest) => api.post<Pipeline>('/pipelines', body),
  update: (id: string, body: UpdatePipelineRequest) =>
    api.patch<Pipeline>(`/pipelines/${enc(id)}`, body),
  remove: (id: string) => api.delete<void>(`/pipelines/${enc(id)}`),
  addStage: (id: string, body: CreateStageRequest) =>
    api.post<Pipeline>(`/pipelines/${enc(id)}/stages`, body),
  updateStage: (id: string, stageId: string, body: UpdateStageRequest) =>
    api.patch<Pipeline>(`/pipelines/${enc(id)}/stages/${enc(stageId)}`, body),
  deleteStage: (id: string, stageId: string, moveDealsToStageId?: string) =>
    api.delete<Pipeline>(`/pipelines/${enc(id)}/stages/${enc(stageId)}`, {
      query: { moveDealsToStageId },
    }),
  reorderStages: (id: string, stageIds: string[]) =>
    api.put<Pipeline>(`/pipelines/${enc(id)}/stages/order`, { stageIds }),
};
