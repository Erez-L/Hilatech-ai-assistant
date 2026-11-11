'use client';

import { Bot, User, Zap } from 'lucide-react';
import type { TaskPriority, TaskSource, TaskStatus } from '@hilatech/contracts';
import { Badge, StatusBadge, type StatusBadgeProps } from '@hilatech/ui';
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_TONES,
  TASK_SOURCE_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONES,
} from '@/lib/tasks';
import { useT } from '@/i18n/provider';

export function TaskStatusBadge({
  status,
  ...props
}: { status: TaskStatus } & Omit<StatusBadgeProps, 'status' | 'tone' | 'label'>) {
  const t = useT();
  return (
    <StatusBadge
      status={status}
      tone={TASK_STATUS_TONES[status]}
      label={t(TASK_STATUS_LABELS[status])}
      {...props}
    />
  );
}

export function TaskPriorityBadge({
  priority,
  ...props
}: { priority: TaskPriority } & Omit<StatusBadgeProps, 'status' | 'tone' | 'label'>) {
  const t = useT();
  return (
    <StatusBadge
      status={priority}
      tone={TASK_PRIORITY_TONES[priority]}
      label={t(TASK_PRIORITY_LABELS[priority])}
      {...props}
    />
  );
}

const SOURCE_ICONS = {
  human: <User aria-hidden />,
  ai: <Bot aria-hidden />,
  automation: <Zap aria-hidden />,
} as const;

/** Where the task came from: a person, an AI tool or an automation step. */
export function TaskSourceBadge({ source }: { source: TaskSource }) {
  const t = useT();
  return (
    <Badge
      variant={source === 'human' ? 'outline' : 'accent'}
      data-testid={`task-source-${source}`}
    >
      {SOURCE_ICONS[source]}
      {t(TASK_SOURCE_LABELS[source])}
    </Badge>
  );
}
