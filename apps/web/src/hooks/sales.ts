'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  BulkAssignTasksRequest,
  CreateCompanyRequest,
  CreateDealRequest,
  CreatePipelineRequest,
  CreateStageRequest,
  CreateTaskRequest,
  DealBoard,
  DealConversionQuery,
  MoveDealRequest,
  PaginationQuery,
  UpdateCompanyRequest,
  UpdateDealRequest,
  UpdatePipelineRequest,
  UpdateStageRequest,
  UpdateTaskRequest,
} from '@hilatech/contracts';
import {
  companiesApi,
  dealsApi,
  importsApi,
  keys,
  pipelinesApi,
  tasksApi,
  type BoardParams,
  type ImportConfigBody,
  type ListCompaniesParams,
  type ListDealsParams,
  type ListImportsParams,
  type ListTasksParams,
} from '@/lib/api';
import { moveDealOnBoard } from '@/lib/deals';
import { isTerminalImport } from '@/lib/imports';
import { useSession } from '@/stores/session';

function useOrgId(): string | null {
  return useSession((s) => s.activeOrganizationId);
}

/** Things that show task numbers outside the task list. */
function invalidateTaskViews(qc: QueryClient, orgId: string | null) {
  void qc.invalidateQueries({ queryKey: keys.tasksRoot(orgId) });
  void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
  void qc.invalidateQueries({ queryKey: ['org', orgId, 'analytics'] });
  void qc.invalidateQueries({ queryKey: keys.notificationsRoot(orgId) });
}

function invalidateDealViews(qc: QueryClient, orgId: string | null) {
  void qc.invalidateQueries({ queryKey: keys.dealsRoot(orgId) });
  void qc.invalidateQueries({ queryKey: keys.pipelines(orgId) });
  void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
  void qc.invalidateQueries({ queryKey: ['org', orgId, 'analytics'] });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function useTasks(params: ListTasksParams, options?: { enabled?: boolean }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.tasks(orgId, params),
    queryFn: () => tasksApi.list(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (body: CreateTaskRequest) => tasksApi.create(body),
    onSuccess: () => invalidateTaskViews(qc, orgId),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTaskRequest }) =>
      tasksApi.update(id, body),
    onSuccess: () => invalidateTaskViews(qc, orgId),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      done ? tasksApi.complete(id) : tasksApi.reopen(id),
    onSuccess: () => invalidateTaskViews(qc, orgId),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    onSuccess: () => invalidateTaskViews(qc, orgId),
  });
}

export function useBulkAssignTasks() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (body: BulkAssignTasksRequest) => tasksApi.bulkAssign(body),
    onSuccess: () => invalidateTaskViews(qc, orgId),
  });
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export function useCompanies(params: ListCompaniesParams, options?: { enabled?: boolean }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.companies(orgId, params),
    queryFn: () => companiesApi.list(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

export function useCompany(id: string | null, options?: { enabled?: boolean }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.company(orgId, id ?? ''),
    queryFn: () => companiesApi.get(id as string),
    enabled: !!orgId && !!id && (options?.enabled ?? true),
  });
}

export function useCompanyContacts(id: string, params: Partial<PaginationQuery> = {}) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.companyContacts(orgId, id, params),
    queryFn: () => companiesApi.contacts(id, params),
    enabled: !!orgId && !!id,
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (body: CreateCompanyRequest) => companiesApi.create(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.companiesRoot(orgId) }),
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCompanyRequest }) =>
      companiesApi.update(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.companiesRoot(orgId) }),
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (id: string) => companiesApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.companiesRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.contactsRoot(orgId) });
    },
  });
}

export function useAssociateContacts() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: ({ id, contactIds }: { id: string; contactIds: string[] }) =>
      companiesApi.associate(id, contactIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.companiesRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.contactsRoot(orgId) });
    },
  });
}

export function useDissociateContact() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: ({ id, contactId }: { id: string; contactId: string }) =>
      companiesApi.dissociate(id, contactId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.companiesRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.contactsRoot(orgId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

export function usePipelines(options?: { enabled?: boolean }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.pipelines(orgId),
    queryFn: pipelinesApi.list,
    enabled: !!orgId && (options?.enabled ?? true),
  });
}

export function usePipelineMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const done = () => invalidateDealViews(qc, orgId);
  return {
    create: useMutation({
      mutationFn: (body: CreatePipelineRequest) => pipelinesApi.create(body),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: UpdatePipelineRequest }) =>
        pipelinesApi.update(id, body),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => pipelinesApi.remove(id),
      onSuccess: done,
    }),
    addStage: useMutation({
      mutationFn: ({ id, body }: { id: string; body: CreateStageRequest }) =>
        pipelinesApi.addStage(id, body),
      onSuccess: done,
    }),
    updateStage: useMutation({
      mutationFn: ({
        id,
        stageId,
        body,
      }: {
        id: string;
        stageId: string;
        body: UpdateStageRequest;
      }) => pipelinesApi.updateStage(id, stageId, body),
      onSuccess: done,
    }),
    deleteStage: useMutation({
      mutationFn: ({
        id,
        stageId,
        moveDealsToStageId,
      }: {
        id: string;
        stageId: string;
        moveDealsToStageId?: string;
      }) => pipelinesApi.deleteStage(id, stageId, moveDealsToStageId),
      onSuccess: done,
    }),
    reorder: useMutation({
      mutationFn: ({ id, stageIds }: { id: string; stageIds: string[] }) =>
        pipelinesApi.reorderStages(id, stageIds),
      onSuccess: done,
    }),
  };
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export function useDealBoard(params: BoardParams, options?: { enabled?: boolean }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.dealBoard(orgId, params),
    queryFn: () => dealsApi.board(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

export function useDeals(params: ListDealsParams, options?: { enabled?: boolean }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.deals(orgId, params),
    queryFn: () => dealsApi.list(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

export function useDeal(id: string | null, options?: { enabled?: boolean }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.deal(orgId, id ?? ''),
    queryFn: () => dealsApi.get(id as string),
    enabled: !!orgId && !!id && (options?.enabled ?? true),
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (body: CreateDealRequest) => dealsApi.create(body),
    onSuccess: () => invalidateDealViews(qc, orgId),
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDealRequest }) =>
      dealsApi.update(id, body),
    onSuccess: () => invalidateDealViews(qc, orgId),
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (id: string) => dealsApi.remove(id),
    onSuccess: () => invalidateDealViews(qc, orgId),
  });
}

type BoardSnapshot = [readonly unknown[], DealBoard | undefined][];

/**
 * Moves a deal. The board caches are updated optimistically (`moveDealOnBoard`) and restored when the
 * server rejects the move; the board and the deal are refetched when the request settles.
 */
export function useMoveDeal() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveDealRequest }) => dealsApi.move(id, body),
    onMutate: async ({ id, body }) => {
      const boardKey = [...keys.dealsRoot(orgId), 'board'] as const;
      await qc.cancelQueries({ queryKey: boardKey });
      const snapshot: BoardSnapshot = qc.getQueriesData<DealBoard>({ queryKey: boardKey });
      for (const [key, board] of snapshot) {
        if (board) qc.setQueryData(key, moveDealOnBoard(board, id, body.stageId, body.position));
      }
      return { snapshot };
    },
    onError: (_error, _vars, ctx) => {
      for (const [key, board] of ctx?.snapshot ?? []) qc.setQueryData(key, board);
    },
    onSettled: () => invalidateDealViews(qc, orgId),
  });
}

export function useDealNotes(id: string) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.dealNotes(orgId, id),
    queryFn: () => dealsApi.notes(id, { page: 1, pageSize: 50 }),
    enabled: !!orgId && !!id,
  });
}

export function useAddDealNote() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => dealsApi.addNote(id, { body }),
    onSuccess: (_n, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.dealNotes(orgId, id) });
      void qc.invalidateQueries({ queryKey: keys.dealActivities(orgId, id) });
    },
  });
}

export function useRemoveDealNote() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: ({ id, noteId }: { id: string; noteId: string }) => dealsApi.removeNote(id, noteId),
    onSuccess: (_n, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.dealNotes(orgId, id) });
      void qc.invalidateQueries({ queryKey: keys.dealActivities(orgId, id) });
    },
  });
}

export function useDealActivities(id: string) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.dealActivities(orgId, id),
    queryFn: () => dealsApi.activities(id, { page: 1, pageSize: 100 }),
    enabled: !!orgId && !!id,
  });
}

export function useDealConversion(
  params: Partial<DealConversionQuery>,
  options?: { enabled?: boolean },
) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.dealConversion(orgId, params),
    queryFn: () => dealsApi.conversion(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export function useImports(params: ListImportsParams, options?: { enabled?: boolean }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.imports(orgId, params),
    queryFn: () => importsApi.list(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
    // Keep the history live while something is running.
    refetchInterval: (query) =>
      query.state.data?.data.some(
        (j) => !isTerminalImport(j.status) && j.status !== 'uploaded' && j.status !== 'validated',
      )
        ? 2000
        : false,
  });
}

/** Polls the job every 800 ms until it reaches a terminal status. */
export function useImportJob(id: string | null, options?: { poll?: boolean }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.importJob(orgId, id ?? ''),
    queryFn: () => importsApi.get(id as string),
    enabled: !!orgId && !!id,
    refetchInterval: (query) =>
      options?.poll && query.state.data && !isTerminalImport(query.state.data.status) ? 800 : false,
  });
}

export function useImportReport(id: string | null, enabled = true) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: keys.importReport(orgId, id ?? ''),
    queryFn: () => importsApi.report(id as string),
    enabled: !!orgId && !!id && enabled,
  });
}

export function useImportMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.importsRoot(orgId) });
  return {
    upload: useMutation({
      mutationFn: ({
        entity,
        file,
      }: {
        entity: Parameters<typeof importsApi.upload>[0];
        file: File;
      }) => importsApi.upload(entity, file),
      onSuccess: refresh,
    }),
    validate: useMutation({
      mutationFn: ({ id, body }: { id: string; body: ImportConfigBody }) =>
        importsApi.validate(id, body),
      onSuccess: refresh,
    }),
    execute: useMutation({
      mutationFn: ({ id, body }: { id: string; body: ImportConfigBody }) =>
        importsApi.execute(id, body),
      onSuccess: () => {
        refresh();
        // Imports create records: every list may change once the job finishes.
        void qc.invalidateQueries({ queryKey: keys.contactsRoot(orgId) });
      },
    }),
    cancel: useMutation({
      mutationFn: (id: string) => importsApi.cancel(id),
      onSuccess: refresh,
    }),
  };
}

/** Deals of one company (company detail page). */
export function useDealsForCompany(companyId: string, enabled = true) {
  return useDeals(
    { companyId, page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' },
    { enabled },
  );
}
