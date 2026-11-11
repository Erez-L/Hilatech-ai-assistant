'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, ListChecks, Plus } from 'lucide-react';
import { Permission, type TaskWithRelations } from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  IconButton,
  Input,
  Skeleton,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useCompleteTask, useCreateTask, useTasks } from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { QueryState } from '@/components/common/query-state';
import { TaskDialog, type TaskRelation } from './task-dialog';
import { TaskDue } from './task-due';
import { TaskPriorityBadge, TaskSourceBadge } from './task-badges';
import { useT } from '@/i18n/provider';

type RelationKey = 'leadId' | 'contactId' | 'dealId' | 'conversationId';

/**
 * Tasks related to one record, with a quick-add field. Shown on the lead, contact and deal pages;
 * hidden without `tasks:read`.
 */
export function TaskPanel({
  relationKey,
  recordId,
  relation,
  idPrefix,
}: {
  relationKey: RelationKey;
  recordId: string;
  /** Labels used by the full dialog. */
  relation?: TaskRelation['labels'];
  idPrefix: string;
}) {
  const t = useT();
  const canRead = useCan(Permission.TASKS_READ);
  const canCreate = useCan(Permission.TASKS_CREATE);
  const canUpdate = useCan(Permission.TASKS_UPDATE);
  const [title, setTitle] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const create = useCreateTask();
  const complete = useCompleteTask();
  const tasks = useTasks(
    {
      [relationKey]: recordId,
      page: 1,
      pageSize: 20,
      sortBy: 'dueAt',
      sortOrder: 'asc',
    },
    { enabled: canRead },
  );

  if (!canRead) return null;

  const relationProps: TaskRelation = { [relationKey]: recordId, labels: relation };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    create.mutate(
      { title: value, priority: 'medium', status: 'todo', [relationKey]: recordId },
      {
        onSuccess: (task) => {
          setTitle('');
          toast.success(t('tasks.taskCreated', { title: task.title }));
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };
  const toggle = (task: TaskWithRelations) => {
    const done = task.status !== 'done';
    complete.mutate(
      { id: task.id, done },
      {
        onSuccess: () =>
          toast.success(done ? t('tasks.taskCompleted', { title: task.title }) : t('tasks.taskReopened', { title: task.title })),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };
  const href = `/tasks?${relationKey}=${encodeURIComponent(recordId)}&status=all`;

  return (
    <Card data-testid="task-panel">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('tasks.tasks')}</CardTitle>
          <CardDescription>{t('tasks.panelDescription')}</CardDescription>
        </div>
        <Link
          href={href}
          className="shrink-0 rounded-sm text-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('tasks.viewAllTasks')}
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canCreate ? (
          <form onSubmit={submit} className="flex items-center gap-2" aria-label={t('tasks.quickAddTask')}>
            <Input
              id={`${idPrefix}-quick-task`}
              aria-label={t('tasks.quickAddTask')}
              dir="auto"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tasks.addATaskPlaceholder')}
              autoComplete="off"
            />
            <Button type="submit" variant="secondary" loading={create.isPending} disabled={!title.trim()} leadingIcon={<Plus aria-hidden />}>
              {t('tasks.add')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(true)}>
              {t('tasks.moreOptions')}
            </Button>
          </form>
        ) : null}

        <QueryState
          query={tasks}
          compact
          loading={
            <div className="flex flex-col gap-3" aria-busy>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          }
          isEmpty={(r) => r.data.length === 0}
          empty={
            <EmptyState compact icon={<ListChecks />} title={t('tasks.noTasksForThisRecord')} description={t('tasks.noTasksForThisRecordHint')} />
          }
        >
          {(r) => (
            <ul className="flex flex-col divide-y divide-border" aria-label={t('tasks.tasks')}>
              {r.data.map((task) => {
                const done = task.status === 'done';
                return (
                  <li key={task.id} className="flex items-start gap-2 py-2.5" data-testid="panel-task">
                    <IconButton
                      size="sm"
                      label={done ? t('tasks.reopenTask', { title: task.title }) : t('tasks.markTaskDone', { title: task.title })}
                      disabled={!canUpdate || task.status === 'cancelled'}
                      aria-pressed={done}
                      onClick={() => toggle(task)}
                    >
                      {done ? <CheckCircle2 className="text-success" aria-hidden /> : <Circle aria-hidden />}
                    </IconButton>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span dir="auto" className={done ? 'text-fg-muted line-through' : 'font-medium'}>
                        {task.title}
                      </span>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                        <TaskDue task={task} />
                        <TaskPriorityBadge priority={task.priority} />
                        <TaskSourceBadge source={task.source} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </CardContent>
      {canCreate ? <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} relation={relationProps} /> : null}
    </Card>
  );
}
