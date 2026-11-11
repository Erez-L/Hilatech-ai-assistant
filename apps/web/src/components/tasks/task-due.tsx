'use client';

import { AlarmClock, CalendarClock } from 'lucide-react';
import type { TaskWithRelations } from '@hilatech/contracts';
import { cn } from '@hilatech/ui';
import { useFormat, useT } from '@/i18n/provider';

/** Due date; overdue open tasks also say so in words (not colour alone). */
export function TaskDue({ task }: { task: Pick<TaskWithRelations, 'dueAt' | 'isOverdue' | 'status'> }) {
  const fmt = useFormat();
  const t = useT();
  if (!task.dueAt) return <span className="text-fg-subtle">{t('tasks.noDueDate')}</span>;
  const overdue = task.isOverdue;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', overdue && 'font-medium text-danger')}>
      {overdue ? <AlarmClock className="size-3.5" aria-hidden /> : <CalendarClock className="size-3.5 text-fg-subtle" aria-hidden />}
      <time dateTime={task.dueAt} title={fmt.dateTime(new Date(task.dueAt), 'long')}>
        {fmt.dateTime(new Date(task.dueAt), 'short')}
      </time>
      {overdue ? <span className="text-xs">{t('tasks.overdue')}</span> : null}
    </span>
  );
}
