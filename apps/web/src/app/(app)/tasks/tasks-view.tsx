'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  Circle,
  FilterX,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserRoundCheck,
} from 'lucide-react';
import { Permission, type TaskStatus, type TaskWithRelations } from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Label,
  NativeSelect,
  PageHeader,
  Pagination,
  SearchInput,
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  toast,
  type SortState,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useMembers } from '@/hooks/queries';
import { useBulkAssignTasks, useCompleteTask, useDeleteTask, useTasks } from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import { fullName } from '@/lib/crm';
import {
  DEFAULT_TASK_FILTERS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  hasActiveTaskFilters,
  taskFiltersToQuery,
  type StatusFilter,
  type TaskFilters,
} from '@/lib/tasks';
import { PermissionGate } from '@/components/common/permission-gate';
import { UserChip } from '@/components/crm/user-chip';
import { LeadPicker } from '@/components/crm/lead-picker';
import { ContactPicker } from '@/components/crm/contact-picker';
import { DealPicker } from '@/components/crm/deal-picker';
import { ConversationPicker } from '@/components/crm/conversation-picker';
import { ExportButton } from '@/components/data-exchange/export-button';
import { TaskDialog } from '@/components/tasks/task-dialog';
import {
  TaskPriorityBadge,
  TaskSourceBadge,
  TaskStatusBadge,
} from '@/components/tasks/task-badges';
import { TaskDue } from '@/components/tasks/task-due';
import { TaskRelated } from '@/components/tasks/task-related';
import { useT } from '@/i18n/provider';

const PAGE_SIZE = 20;
type SortKey = 'dueAt' | 'createdAt' | 'updatedAt' | 'priority' | 'title';
type RelatedKind = '' | 'lead' | 'contact' | 'deal' | 'conversation';

function initialFilters(params: URLSearchParams): TaskFilters {
  const status = params.get('status');
  return {
    ...DEFAULT_TASK_FILTERS,
    status:
      status === 'all' || status === 'open' || TASK_STATUSES.includes(status as TaskStatus)
        ? (status as StatusFilter)
        : 'open',
    assignee: params.get('assigneeId') ?? '',
    overdue: params.get('overdue') === 'true',
    leadId: params.get('leadId') ?? '',
    contactId: params.get('contactId') ?? '',
    dealId: params.get('dealId') ?? '',
    conversationId: params.get('conversationId') ?? '',
  };
}

function relatedKindOf(f: TaskFilters): RelatedKind {
  return f.leadId
    ? 'lead'
    : f.contactId
      ? 'contact'
      : f.dealId
        ? 'deal'
        : f.conversationId
          ? 'conversation'
          : '';
}

export function TasksView() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useSession((s) => s.user);
  const canCreate = useCan(Permission.TASKS_CREATE);
  const canUpdate = useCan(Permission.TASKS_UPDATE);
  const canDelete = useCan(Permission.TASKS_DELETE);
  const canAssign = useCan(Permission.TASKS_ASSIGN);
  const canReadMembers = useCan(Permission.MEMBERS_READ);

  const [filters, setFilters] = React.useState<TaskFilters>(() => initialFilters(searchParams));
  const [relatedKind, setRelatedKind] = React.useState<RelatedKind>(() =>
    relatedKindOf(initialFilters(searchParams)),
  );
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<SortState<SortKey>>({ key: 'dueAt', direction: 'asc' });
  const [createOpen, setCreateOpen] = React.useState(searchParams.get('new') === '1');
  const [editing, setEditing] = React.useState<TaskWithRelations | null>(null);
  const [deleting, setDeleting] = React.useState<TaskWithRelations | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkAssignee, setBulkAssignee] = React.useState('');

  const set = (patch: Partial<TaskFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  // The `me` token is resolved by the API; a concrete user id is sent as-is.
  const query = React.useMemo(
    () => ({
      ...taskFiltersToQuery(filters),
      page,
      pageSize: PAGE_SIZE,
      sortBy: sort.key,
      sortOrder: sort.direction,
    }),
    [filters, page, sort],
  );
  const tasks = useTasks(query);
  const members = useMembers({ page: 1, pageSize: 100 });
  const complete = useCompleteTask();
  const remove = useDeleteTask();
  const bulk = useBulkAssignTasks();

  const hasFilters = hasActiveTaskFilters(filters);
  const reset = () => {
    setFilters(DEFAULT_TASK_FILTERS);
    setRelatedKind('');
    setPage(1);
    if (searchParams.toString()) router.replace('/tasks');
  };

  const rows = React.useMemo(() => tasks.data?.data ?? [], [tasks.data]);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));
  const toggleAll = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  const toggleOne = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleDone = (task: TaskWithRelations) => {
    const done = task.status !== 'done';
    complete.mutate(
      { id: task.id, done },
      {
        onSuccess: () =>
          toast.success(
            done
              ? t('tasks.taskCompleted', { title: task.title })
              : t('tasks.taskReopened', { title: task.title }),
          ),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  const runBulkAssign = () => {
    bulk.mutate(
      {
        taskIds: [...selected],
        assigneeId: bulkAssignee === '' || bulkAssignee === 'none' ? null : bulkAssignee,
      },
      {
        onSuccess: (r) => {
          toast.success(t('tasks.bulkAssigned', { count: r.updated }));
          setSelected(new Set());
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  const exportFilters = {
    status: query.status && query.status.length ? query.status.join(',') : undefined,
    priority: query.priority,
    assigneeId: query.assigneeId,
    overdue: query.overdue ? true : undefined,
  };

  return (
    <PermissionGate anyOf={[Permission.TASKS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('tasks.tasks')}
          description={t('tasks.followUpsReminders')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ExportButton entity="tasks" filters={exportFilters} label={t('tasks.tasks')} />
              {canCreate ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreateOpen(true)}>
                  {t('tasks.newTask')}
                </Button>
              ) : null}
            </div>
          }
        />

        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tasks-search">{t('common.search')}</Label>
                <SearchInput
                  id="tasks-search"
                  value={filters.search}
                  onValueChange={(v) => set({ search: v })}
                  placeholder={t('tasks.searchTitleOrDescription')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tasks-status">{t('common.status')}</Label>
                <NativeSelect
                  id="tasks-status"
                  value={filters.status}
                  onChange={(e) => set({ status: e.target.value as StatusFilter })}
                >
                  <option value="open">{t('tasks.statusOpen')}</option>
                  <option value="all">{t('common.allStatuses')}</option>
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(TASK_STATUS_LABELS[s])}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tasks-priority">{t('tasks.priority')}</Label>
                <NativeSelect
                  id="tasks-priority"
                  value={filters.priority}
                  onChange={(e) => set({ priority: e.target.value as TaskFilters['priority'] })}
                >
                  <option value="">{t('tasks.allPriorities')}</option>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(TASK_PRIORITY_LABELS[p])}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tasks-assignee">{t('common.assignee')}</Label>
                <NativeSelect
                  id="tasks-assignee"
                  value={filters.assignee}
                  onChange={(e) => set({ assignee: e.target.value })}
                >
                  <option value="">{t('common.anyone')}</option>
                  <option value="me">{t('tasks.assignedToMe')}</option>
                  <option value="unassigned">{t('common.unassigned')}</option>
                  {(members.data?.data ?? [])
                    .filter((m) => m.status === 'active' && m.userId !== me?.id)
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {fullName(m.user)}
                      </option>
                    ))}
                </NativeSelect>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tasks-due">{t('tasks.dueDate')}</Label>
                <NativeSelect
                  id="tasks-due"
                  value={filters.due}
                  onChange={(e) => set({ due: e.target.value as TaskFilters['due'] })}
                >
                  <option value="any">{t('tasks.anyDueDate')}</option>
                  <option value="today">{t('tasks.dueToday')}</option>
                  <option value="next7">{t('tasks.dueNext7Days')}</option>
                  <option value="custom">{t('tasks.customRange')}</option>
                </NativeSelect>
              </div>
              {filters.due === 'custom' ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tasks-due-from">{t('tasks.dueFrom')}</Label>
                    <Input
                      id="tasks-due-from"
                      type="date"
                      dir="ltr"
                      className="text-start"
                      value={filters.dueFrom}
                      onChange={(e) => set({ dueFrom: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tasks-due-to">{t('tasks.dueTo')}</Label>
                    <Input
                      id="tasks-due-to"
                      type="date"
                      dir="ltr"
                      className="text-start"
                      value={filters.dueTo}
                      onChange={(e) => set({ dueTo: e.target.value })}
                    />
                  </div>
                </>
              ) : null}
              <div className="flex items-center gap-2.5 sm:pb-2">
                <Checkbox
                  id="tasks-overdue"
                  checked={filters.overdue}
                  onCheckedChange={(c) => set({ overdue: c === true })}
                />
                <Label htmlFor="tasks-overdue" className="font-normal">
                  {t('tasks.overdueOnly')}
                </Label>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[12rem_1fr_auto] xl:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tasks-related-kind">{t('tasks.relatedTo')}</Label>
                <NativeSelect
                  id="tasks-related-kind"
                  value={relatedKind}
                  onChange={(e) => {
                    setRelatedKind(e.target.value as RelatedKind);
                    set({ leadId: '', contactId: '', dealId: '', conversationId: '' });
                  }}
                >
                  <option value="">{t('tasks.anyRecord')}</option>
                  <option value="lead">{t('common.lead')}</option>
                  <option value="contact">{t('common.contact')}</option>
                  <option value="deal">{t('deals.deal')}</option>
                  <option value="conversation">{t('tasks.conversation')}</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tasks-related-record">{t('tasks.relatedRecord')}</Label>
                {relatedKind === 'lead' ? (
                  <LeadPicker
                    id="tasks-related-record"
                    value={filters.leadId || null}
                    onValueChange={(id) => set({ leadId: id ?? '' })}
                  />
                ) : relatedKind === 'contact' ? (
                  <ContactPicker
                    id="tasks-related-record"
                    value={filters.contactId || null}

                    onValueChange={(id) => set({ contactId: id ?? '' })}
                  />
                ) : relatedKind === 'deal' ? (
                  <DealPicker
                    id="tasks-related-record"
                    value={filters.dealId || null}
                    onValueChange={(id) => set({ dealId: id ?? '' })}
                  />
                ) : relatedKind === 'conversation' ? (
                  <ConversationPicker
                    id="tasks-related-record"
                    value={filters.conversationId || null}
                    onValueChange={(id) => set({ conversationId: id ?? '' })}
                  />
                ) : (
                  <NativeSelect id="tasks-related-record" disabled value="">
                    <option value="">{t('tasks.chooseARecordType')}</option>
                  </NativeSelect>
                )}
              </div>
              <Button
                variant="ghost"
                onClick={reset}
                disabled={!hasFilters}
                leadingIcon={<FilterX aria-hidden />}
              >
                {t('common.clear')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {canAssign && selected.size > 0 ? (
          <div
            role="region"
            aria-label={t('tasks.bulkActions')}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft px-4 py-3"
          >
            <span className="text-sm font-medium" aria-live="polite">
              {t('tasks.selectedCount', { count: selected.size })}
            </span>
            <div className="flex min-w-48 flex-1 items-center gap-2 sm:max-w-sm">
              <Label htmlFor="tasks-bulk-assignee" className="sr-only">
                {t('tasks.assignSelectedTo')}
              </Label>
              <NativeSelect
                id="tasks-bulk-assignee"
                value={bulkAssignee}
                onChange={(e) => setBulkAssignee(e.target.value)}
                disabled={!canReadMembers}
              >
                <option value="">{t('tasks.chooseAnAssignee')}</option>
                <option value="none">{t('common.unassigned')}</option>
                {(members.data?.data ?? [])
                  .filter((m) => m.status === 'active')
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {fullName(m.user)}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <Button
              leadingIcon={<UserRoundCheck aria-hidden />}
              disabled={bulkAssignee === ''}
              loading={bulk.isPending}
              onClick={runBulkAssign}
            >
              {t('tasks.assign')}
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              {t('tasks.clearSelection')}
            </Button>
          </div>
        ) : null}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {canAssign ? (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label={t('tasks.selectAllOnThisPage')}
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={(c) => toggleAll(c === true)}
                      />
                    </TableHead>
                  ) : null}
                  <SortableHead
                    sortKey="title"
                    sort={sort}
                    onSortChange={(s) => {
                      setSort(s);
                      setPage(1);
                    }}
                  >
                    {t('tasks.task')}
                  </SortableHead>
                  <SortableHead
                    sortKey="priority"
                    sort={sort}
                    onSortChange={(s) => {
                      setSort(s);
                      setPage(1);
                    }}
                    className="hidden sm:table-cell"
                  >
                    {t('tasks.priority')}
                  </SortableHead>
                  <SortableHead
                    sortKey="dueAt"
                    sort={sort}
                    onSortChange={(s) => {
                      setSort(s);
                      setPage(1);
                    }}
                    className="hidden sm:table-cell"
                  >
                    {t('tasks.due')}
                  </SortableHead>
                  <TableHead className="hidden md:table-cell">{t('common.assignee')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('tasks.related')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('common.status')}</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.isPending ? (
                  <TableSkeletonRows columns={canAssign ? 8 : 7} rows={8} />
                ) : tasks.isError ? (
                  <TableEmptyRow colSpan={canAssign ? 8 : 7}>
                    <div className="flex flex-col items-center gap-2">
                      <span>{getErrorMessage(tasks.error)}</span>
                      <Button variant="secondary" size="sm" onClick={() => void tasks.refetch()}>
                        {t('common.tryAgain')}
                      </Button>
                    </div>
                  </TableEmptyRow>
                ) : rows.length === 0 ? (
                  <TableEmptyRow colSpan={canAssign ? 8 : 7} className="py-4">
                    <EmptyState
                      compact
                      icon={<ListChecks />}
                      title={
                        hasFilters ? t('tasks.noTasksMatchTheseFilters') : t('tasks.noTasksYet')
                      }
                      description={
                        hasFilters ? t('common.tryDifferentFilters') : t('tasks.addYourFirstTask')
                      }
                      action={
                        hasFilters ? (
                          <Button variant="secondary" size="sm" onClick={reset}>
                            {t('common.clearFilters')}
                          </Button>
                        ) : canCreate ? (
                          <Button
                            size="sm"
                            leadingIcon={<Plus aria-hidden />}
                            onClick={() => setCreateOpen(true)}
                          >
                            {t('tasks.newTask')}
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableEmptyRow>
                ) : (
                  rows.map((task) => {
                    const done = task.status === 'done';
                    return (
                      <TableRow key={task.id} data-testid="task-row" data-status={task.status}>
                        {canAssign ? (
                          <TableCell>
                            <Checkbox
                              aria-label={t('tasks.selectTask', { title: task.title })}
                              checked={selected.has(task.id)}
                              onCheckedChange={(c) => toggleOne(task.id, c === true)}
                            />
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <div className="flex min-w-0 items-start gap-2">
                            <IconButton
                              size="sm"
                              label={
                                done
                                  ? t('tasks.reopenTask', { title: task.title })
                                  : t('tasks.markTaskDone', { title: task.title })
                              }
                              disabled={
                                !canUpdate || task.status === 'cancelled' || complete.isPending
                              }
                              onClick={() => toggleDone(task)}
                              aria-pressed={done}
                            >
                              {done ? (
                                <CheckCircle2 className="text-success" aria-hidden />
                              ) : (
                                <Circle aria-hidden />
                              )}
                            </IconButton>
                            <div className="flex min-w-0 flex-col items-start gap-1">
                              <button
                                type="button"
                                className={`truncate text-start font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${done ? 'text-fg-muted line-through' : ''}`}
                                dir="auto"
                                onClick={() => setEditing(task)}
                              >
                                {task.title}
                              </button>
                              <div className="flex flex-wrap items-center gap-1">
                                <TaskSourceBadge source={task.source} />
                                <span className="sm:hidden">
                                  <TaskPriorityBadge priority={task.priority} />
                                </span>
                              </div>
                              <div className="sm:hidden">
                                <TaskDue task={task} />
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <TaskPriorityBadge priority={task.priority} />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <TaskDue task={task} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <UserChip user={task.assignee} />
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <TaskRelated task={task} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <TaskStatusBadge status={task.status} />
                        </TableCell>
                        <TableCell>
                          {canUpdate || canDelete ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton label={t('common.actionsFor', { name: task.title })}>
                                  <MoreHorizontal aria-hidden />
                                </IconButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canUpdate ? (
                                  <DropdownMenuItem onSelect={() => setEditing(task)}>
                                    <Pencil aria-hidden /> {t('common.edit')}
                                  </DropdownMenuItem>
                                ) : null}
                                {canUpdate && canDelete ? <DropdownMenuSeparator /> : null}
                                {canDelete ? (
                                  <DropdownMenuItem
                                    onSelect={() => setDeleting(task)}
                                    className="text-danger"
                                  >
                                    <Trash2 aria-hidden /> {t('common.delete')}
                                  </DropdownMenuItem>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            {tasks.data && tasks.data.meta.total > PAGE_SIZE ? (
              <div className="border-t border-border px-5 py-3">
                <Pagination
                  page={tasks.data.meta.page}
                  pageSize={tasks.data.meta.pageSize}
                  total={tasks.data.meta.total}
                  onPageChange={setPage}
                  itemLabel={t('tasks.tasksLower')}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <TaskDialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open && searchParams.get('new')) router.replace('/tasks');
          }}
        />
        <TaskDialog
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          task={editing}
        />
        <ConfirmDialog
          open={!!deleting}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t('tasks.deleteThisTask')}
          description={t('tasks.deleteTaskBody', { title: deleting?.title ?? '' })}
          confirmLabel={t('common.delete')}
          tone="danger"
          loading={remove.isPending}
          onConfirm={() => {
            if (!deleting) return;
            remove.mutate(deleting.id, {
              onSuccess: () => {
                toast.success(t('tasks.taskDeleted', { title: deleting.title }));
                setDeleting(null);
              },
              onError: (e) => toast.error(getErrorMessage(e)),
            });
          }}
        />
      </div>
    </PermissionGate>
  );
}
