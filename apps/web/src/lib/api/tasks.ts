import type {
  BulkAssignTasksRequest,
  BulkAssignTasksResult,
  CreateTaskRequest,
  ListTasksQuery,
  TaskWithRelations,
  UpdateTaskRequest,
} from '@hilatech/contracts';
import { api } from './client';

/** Filters accepted by GET /tasks. `status` is a list that is sent comma-separated. */
export type ListTasksParams = Partial<Omit<ListTasksQuery, 'status'>> & {
  status?: readonly string[];
};

const enc = encodeURIComponent;

export const tasksApi = {
  list: (query: ListTasksParams = {}) =>
    api.list<TaskWithRelations>('/tasks', {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      status: query.status && query.status.length > 0 ? query.status.join(',') : undefined,
      priority: query.priority,
      assigneeId: query.assigneeId,
      unassigned: query.unassigned ? true : undefined,
      dueFrom: query.dueFrom,
      dueTo: query.dueTo,
      overdue: query.overdue ? true : undefined,
      leadId: query.leadId,
      contactId: query.contactId,
      dealId: query.dealId,
      conversationId: query.conversationId,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  get: (id: string) => api.get<TaskWithRelations>(`/tasks/${enc(id)}`),
  create: (body: CreateTaskRequest) => api.post<TaskWithRelations>('/tasks', body),
  update: (id: string, body: UpdateTaskRequest) =>
    api.patch<TaskWithRelations>(`/tasks/${enc(id)}`, body),
  remove: (id: string) => api.delete<void>(`/tasks/${enc(id)}`),
  complete: (id: string) => api.post<TaskWithRelations>(`/tasks/${enc(id)}/complete`),
  reopen: (id: string) => api.post<TaskWithRelations>(`/tasks/${enc(id)}/reopen`),
  bulkAssign: (body: BulkAssignTasksRequest) =>
    api.post<BulkAssignTasksResult>('/tasks/bulk-assign', body),
};
