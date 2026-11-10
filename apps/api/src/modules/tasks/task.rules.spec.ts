import { Permission } from '@hilatech/contracts';

import { AppException } from '../../common/errors/app.exception';
import { TaskRules } from './task.rules';

const NOW = new Date('2030-01-01T12:00:00Z');
const tenant = (permissions: string[]) => ({ userId: 'u1', permissions }) as never;

describe('TaskRules', () => {
  it('detects open and overdue tasks', () => {
    expect(TaskRules.isOpen('todo')).toBe(true);
    expect(TaskRules.isOpen('in_progress')).toBe(true);
    expect(TaskRules.isOpen('done')).toBe(false);
    expect(TaskRules.isOverdue({ status: 'todo', dueAt: new Date('2029-12-31T00:00:00Z') }, NOW)).toBe(true);
    expect(TaskRules.isOverdue({ status: 'done', dueAt: new Date('2029-12-31T00:00:00Z') }, NOW)).toBe(false);
    expect(TaskRules.isOverdue({ status: 'todo', dueAt: null }, NOW)).toBe(false);
    expect(TaskRules.isOverdue({ status: 'todo', dueAt: new Date('2030-01-02T00:00:00Z') }, NOW)).toBe(false);
  });

  it('only tasks:assign may give a task to someone else', () => {
    const plain = tenant([Permission.TASKS_UPDATE]);
    expect(() => TaskRules.assertCanSetAssignee(plain, 'u1', null)).not.toThrow();
    expect(() => TaskRules.assertCanSetAssignee(plain, null, 'u2')).not.toThrow();
    expect(() => TaskRules.assertCanSetAssignee(plain, 'u2', 'u2')).not.toThrow();
    expect(() => TaskRules.assertCanSetAssignee(plain, 'u2', null)).toThrow(AppException);
    expect(() => TaskRules.assertCanSetAssignee(tenant([Permission.TASKS_ASSIGN]), 'u2', null)).not.toThrow();
  });

  it('completes and reopens only when the state changes', () => {
    expect(TaskRules.completionData({ status: 'todo' }, NOW)).toEqual({ status: 'done', completedAt: NOW });
    expect(TaskRules.completionData({ status: 'done' }, NOW)).toBeNull();
    expect(TaskRules.reopenData({ status: 'done' })).toEqual({ status: 'todo', completedAt: null });
    expect(TaskRules.reopenData({ status: 'cancelled' })).toEqual({ status: 'todo', completedAt: null });
    expect(TaskRules.reopenData({ status: 'in_progress' })).toBeNull();
  });

  it('resets the reminder marker only when reminderAt actually changes', () => {
    const prev = { reminderAt: new Date('2030-01-01T10:00:00Z') };
    expect(TaskRules.shouldResetReminder(prev, undefined)).toBe(false);
    expect(TaskRules.shouldResetReminder(prev, new Date('2030-01-01T10:00:00Z'))).toBe(false);
    expect(TaskRules.shouldResetReminder(prev, new Date('2030-01-01T11:00:00Z'))).toBe(true);
    expect(TaskRules.shouldResetReminder(prev, null)).toBe(true);
    expect(TaskRules.shouldResetReminder({ reminderAt: null }, null)).toBe(false);
  });
});
