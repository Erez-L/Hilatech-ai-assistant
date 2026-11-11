import {
  OPEN_TASK_STATUSES,
  type ListTasksQuery,
  type TaskPriority,
  type TaskSource,
  type TaskStatus,
} from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';
import { msg, type Msg } from '@/i18n/msg';
import type { ListTasksParams } from '@/lib/api/tasks';

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled'];
export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
export const TASK_SOURCES: readonly TaskSource[] = ['human', 'ai', 'automation'];

export const TASK_STATUS_LABELS: Record<TaskStatus, Msg> = {
  todo: msg('tasks.status.todo'),
  in_progress: msg('tasks.status.in_progress'),
  done: msg('tasks.status.done'),
  cancelled: msg('tasks.status.cancelled'),
};
export const TASK_STATUS_TONES: Record<TaskStatus, StatusTone> = {
  todo: 'neutral',
  in_progress: 'info',
  done: 'success',
  cancelled: 'neutral',
};
export const TASK_PRIORITY_LABELS: Record<TaskPriority, Msg> = {
  low: msg('tasks.priority.low'),
  medium: msg('tasks.priority.medium'),
  high: msg('tasks.priority.high'),
  urgent: msg('tasks.priority.urgent'),
};
export const TASK_PRIORITY_TONES: Record<TaskPriority, StatusTone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
};
export const TASK_SOURCE_LABELS: Record<TaskSource, Msg> = {
  human: msg('tasks.source.human'),
  ai: msg('tasks.source.ai'),
  automation: msg('tasks.source.automation'),
};

export type StatusFilter = 'open' | 'all' | TaskStatus;
export type AssigneeFilter = '' | 'me' | 'unassigned' | (string & {});
export type DueFilter = 'any' | 'today' | 'next7' | 'custom';

export interface TaskFilters {
  search: string;
  status: StatusFilter;
  priority: TaskPriority | '';
  assignee: AssigneeFilter;
  due: DueFilter;
  /** yyyy-mm-dd, only used when `due` is `custom`. */
  dueFrom: string;
  dueTo: string;
  overdue: boolean;
  leadId: string;
  contactId: string;
  dealId: string;
  conversationId: string;
}

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  search: '',
  status: 'open',
  priority: '',
  assignee: '',
  due: 'any',
  dueFrom: '',
  dueTo: '',
  overdue: false,
  leadId: '',
  contactId: '',
  dealId: '',
  conversationId: '',
};

/** Local start of day for a yyyy-mm-dd string. */
function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00`);
}
function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** Inclusive `dueFrom` / exclusive `dueTo` for a due-date preset (local calendar days). */
export function dueRange(
  filters: Pick<TaskFilters, 'due' | 'dueFrom' | 'dueTo'>,
  now: Date = new Date(),
): { dueFrom?: string; dueTo?: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (filters.due) {
    case 'today':
      return { dueFrom: today.toISOString(), dueTo: addDays(today, 1).toISOString() };
    case 'next7':
      return { dueFrom: today.toISOString(), dueTo: addDays(today, 8).toISOString() };
    case 'custom':
      return {
        ...(filters.dueFrom ? { dueFrom: dayStart(filters.dueFrom).toISOString() } : {}),
        // `to` is a calendar day chosen by the user and is inclusive in the UI.
        ...(filters.dueTo ? { dueTo: addDays(dayStart(filters.dueTo), 1).toISOString() } : {}),
      };
    default:
      return {};
  }
}

/** Maps the UI filter state to GET /tasks params. */
export function taskFiltersToQuery(filters: TaskFilters, now: Date = new Date()): ListTasksParams {
  const status: readonly TaskStatus[] | undefined =
    filters.status === 'all'
      ? undefined
      : filters.status === 'open'
        ? OPEN_TASK_STATUSES
        : [filters.status];
  return {
    search: filters.search.trim() || undefined,
    status: status ? [...status] : undefined,
    priority: filters.priority || undefined,
    assigneeId:
      filters.assignee && filters.assignee !== 'unassigned'
        ? (filters.assignee as ListTasksQuery['assigneeId'])
        : undefined,
    unassigned: filters.assignee === 'unassigned' ? true : undefined,
    overdue: filters.overdue || undefined,
    leadId: filters.leadId || undefined,
    contactId: filters.contactId || undefined,
    dealId: filters.dealId || undefined,
    conversationId: filters.conversationId || undefined,
    ...dueRange(filters, now),
  };
}

export function hasActiveTaskFilters(f: TaskFilters): boolean {
  return (
    f.search.trim() !== '' ||
    f.status !== DEFAULT_TASK_FILTERS.status ||
    f.priority !== '' ||
    f.assignee !== '' ||
    f.due !== 'any' ||
    f.overdue ||
    f.leadId !== '' ||
    f.contactId !== '' ||
    f.dealId !== '' ||
    f.conversationId !== ''
  );
}

/** `datetime-local` value (local time) <-> ISO string. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
