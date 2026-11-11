import { z } from 'zod';
import {
  idSchema,
  paginationQuerySchema,
  sortOrderSchema,
  timestampsSchema,
  userSummarySchema,
} from './common';
import { contactSummarySchema } from './crm';

// ---------------------------------------------------------------------------
// Tasks: to-dos with due dates and reminders, optionally related to one CRM entity.
// ---------------------------------------------------------------------------

export const TaskStatus = z.enum(['todo', 'in_progress', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress'];

export const TaskPriority = z.enum(['low', 'medium', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPriority>;

/** `human` = created through the API by a person, `ai` = created by an assistant/agent tool, `automation` = workflow step. */
export const TaskSource = z.enum(['human', 'ai', 'automation']);
export type TaskSource = z.infer<typeof TaskSource>;

/** Query-string boolean: accepts `true` / `false` (and real booleans). */
export const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const taskSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    title: z.string(),
    description: z.string().nullable(),
    status: TaskStatus,
    priority: TaskPriority,
    dueAt: z.string().datetime().nullable(),
    reminderAt: z.string().datetime().nullable(),
    /** Set once the reminder notification has been created. */
    reminderSentAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    assigneeId: idSchema.nullable(),
    createdById: idSchema.nullable(),
    source: TaskSource,
    leadId: idSchema.nullable(),
    contactId: idSchema.nullable(),
    dealId: idSchema.nullable(),
    conversationId: idSchema.nullable(),
  })
  .merge(timestampsSchema);
export type Task = z.infer<typeof taskSchema>;

export const taskWithRelationsSchema = taskSchema.extend({
  assignee: userSummarySchema.nullable(),
  createdBy: userSummarySchema.nullable(),
  lead: z.object({ id: idSchema, title: z.string() }).nullable(),
  contact: contactSummarySchema.nullable(),
  deal: z.object({ id: idSchema, title: z.string() }).nullable(),
  conversation: z.object({ id: idSchema, subject: z.string().nullable() }).nullable(),
  /** Open task whose due date is in the past. */
  isOverdue: z.boolean(),
});
export type TaskWithRelations = z.infer<typeof taskWithRelationsSchema>;

const taskBase = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  priority: TaskPriority.default('medium'),
  dueAt: z.string().datetime().optional(),
  reminderAt: z.string().datetime().optional(),
  assigneeId: idSchema.optional(),
  leadId: idSchema.optional(),
  contactId: idSchema.optional(),
  dealId: idSchema.optional(),
  conversationId: idSchema.optional(),
});

const reminderNotAfterDue = (v: { dueAt?: string | null; reminderAt?: string | null }) =>
  !v.dueAt || !v.reminderAt || new Date(v.reminderAt).getTime() <= new Date(v.dueAt).getTime();

export const createTaskSchema = taskBase
  .extend({ status: z.enum(['todo', 'in_progress']).default('todo') })
  .refine(reminderNotAfterDue, {
    message: 'reminderAt must not be after dueAt',
    path: ['reminderAt'],
  });
export type CreateTaskRequest = z.infer<typeof createTaskSchema>;

/** PATCH: every field optional; `null` clears dueAt / reminderAt / assigneeId / related ids. Use /complete and /reopen for done. */
export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullable(),
    priority: TaskPriority,
    status: z.enum(['todo', 'in_progress', 'cancelled']),
    dueAt: z.string().datetime().nullable(),
    reminderAt: z.string().datetime().nullable(),
    assigneeId: idSchema.nullable(),
    leadId: idSchema.nullable(),
    contactId: idSchema.nullable(),
    dealId: idSchema.nullable(),
    conversationId: idSchema.nullable(),
  })
  .partial()
  .refine(reminderNotAfterDue, {
    message: 'reminderAt must not be after dueAt',
    path: ['reminderAt'],
  });
export type UpdateTaskRequest = z.infer<typeof updateTaskSchema>;

const csvEnumList = <T extends z.ZodType<string, string>>(values: T) =>
  z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(values).min(1).max(8));

export const listTasksQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  /** One status or a comma-separated list (`todo,in_progress`). */
  status: csvEnumList(TaskStatus).optional(),
  priority: TaskPriority.optional(),
  /** User id, or `me` for the caller. */
  assigneeId: z.union([idSchema, z.literal('me')]).optional(),
  unassigned: queryBoolean.optional(),
  /** Due date range (inclusive `dueFrom`, exclusive `dueTo`). */
  dueFrom: z.string().datetime().optional(),
  dueTo: z.string().datetime().optional(),
  /** Only open tasks that are past due. */
  overdue: queryBoolean.optional(),
  leadId: idSchema.optional(),
  contactId: idSchema.optional(),
  dealId: idSchema.optional(),
  conversationId: idSchema.optional(),
  sortBy: z.enum(['dueAt', 'createdAt', 'updatedAt', 'priority', 'title']).default('dueAt'),
  sortOrder: sortOrderSchema.default('asc'),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const bulkAssignTasksSchema = z.object({
  taskIds: z.array(idSchema).min(1).max(100),
  assigneeId: idSchema.nullable(),
});
export type BulkAssignTasksRequest = z.infer<typeof bulkAssignTasksSchema>;

export const bulkAssignTasksResultSchema = z.object({
  /** Tasks whose assignee changed. */
  updated: z.number().int().nonnegative(),
  /** Ids that were already assigned to that user (no change). */
  unchanged: z.array(idSchema),
  /** Ids not found in the organization (never reveals other tenants). */
  notFound: z.array(idSchema),
});
export type BulkAssignTasksResult = z.infer<typeof bulkAssignTasksResultSchema>;
