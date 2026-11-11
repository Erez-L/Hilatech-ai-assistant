import { OPEN_TASK_STATUSES, Permission, type TaskStatus } from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';

import { AppException } from '../../common/errors/app.exception';

/** Pure business rules for tasks; exported for unit tests. */
export const TaskRules = {
  isOpen(status: TaskStatus): boolean {
    return OPEN_TASK_STATUSES.includes(status);
  },

  /** Open task whose due date has passed. */
  isOverdue(task: { status: TaskStatus; dueAt: Date | null }, now: Date): boolean {
    return (
      TaskRules.isOpen(task.status) && task.dueAt !== null && task.dueAt.getTime() < now.getTime()
    );
  },

  /**
   * Assigning a task to someone else requires `tasks:assign`; `tasks:update`/`tasks:create` alone only allow taking
   * (or keeping) the task yourself or leaving it unassigned.
   */
  assertCanSetAssignee(
    tenant: Pick<TenantContext, 'userId' | 'permissions'>,
    next: string | null,
    previous: string | null,
  ): void {
    if (next === previous || next === null || next === tenant.userId) return;
    if (!tenant.permissions.includes(Permission.TASKS_ASSIGN)) {
      throw AppException.forbidden('Assigning tasks to other members requires tasks:assign', {
        required: [Permission.TASKS_ASSIGN],
      });
    }
  },

  /** Fields written when a task is completed. Completing a finished task is a no-op (returns null). */
  completionData(
    task: { status: TaskStatus },
    now: Date,
  ): { status: 'done'; completedAt: Date } | null {
    return task.status === 'done' ? null : { status: 'done', completedAt: now };
  },

  /** Reopening is allowed from done/cancelled; open tasks are left as they are (returns null). */
  reopenData(task: { status: TaskStatus }): { status: 'todo'; completedAt: null } | null {
    return task.status === 'done' || task.status === 'cancelled'
      ? { status: 'todo', completedAt: null }
      : null;
  },

  /**
   * The reminder must fire again when its time changes: `reminderSentAt` is cleared whenever `reminderAt` is set to a
   * different value (or removed), and when a finished task is reopened with a pending reminder.
   */
  shouldResetReminder(
    previous: { reminderAt: Date | null },
    nextReminderAt: Date | null | undefined,
  ): boolean {
    if (nextReminderAt === undefined) return false;
    const before = previous.reminderAt?.getTime() ?? null;
    const after = nextReminderAt?.getTime() ?? null;
    return before !== after;
  },
};
