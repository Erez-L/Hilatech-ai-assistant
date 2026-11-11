import {
  AuditAction,
  type BulkAssignTasksRequest,
  type BulkAssignTasksResult,
  type CreateTaskRequest,
  type ListTasksQuery,
  OPEN_TASK_STATUSES,
  type TaskWithRelations,
  type UpdateTaskRequest,
} from '@hilatech/contracts';
import { type Prisma, type Task } from '@hilatech/database';
import { truncate } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable, Optional } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CrmReferencesService } from '../crm/crm-references.service';
import { DomainEventsService } from '../events/domain-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TaskRules } from './task.rules';
import { TASK_INCLUDE, type TaskRow, toTaskWithRelations } from './tasks.mappers';

type TaskEvent = 'task.created' | 'task.completed';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refs: CrmReferencesService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly events?: DomainEventsService,
  ) {}

  async list(tenant: TenantContext, query: ListTasksQuery): Promise<PageResult<TaskWithRelations>> {
    const now = new Date();
    const where = buildTaskWhere(tenant, query, now);
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.task.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: taskOrderBy(query),
        ...skipTake(query),
      }),
      this.prisma.client.task.count({ where }),
    ]);
    return page(
      rows.map((r) => toTaskWithRelations(r, now)),
      query,
      total,
    );
  }

  async get(tenant: TenantContext, id: string): Promise<TaskWithRelations> {
    return toTaskWithRelations(await this.requireTask(tenant, id));
  }

  async create(
    tenant: TenantContext,
    dto: CreateTaskRequest,
    meta: RequestMeta,
  ): Promise<TaskWithRelations> {
    await this.assertReferences(tenant, dto);
    if (dto.assigneeId) {
      await this.refs.assertActiveMember(tenant, dto.assigneeId, 'assigneeId');
      TaskRules.assertCanSetAssignee(tenant, dto.assigneeId, null);
    }
    const created = await this.prisma.client.task.create({
      data: {
        organizationId: tenant.organizationId,
        title: dto.title,
        description: dto.description ?? null,
        status: dto.status,
        priority: dto.priority,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        reminderAt: dto.reminderAt ? new Date(dto.reminderAt) : null,
        assigneeId: dto.assigneeId ?? null,
        createdById: tenant.userId,
        source: 'human',
        leadId: dto.leadId ?? null,
        contactId: dto.contactId ?? null,
        dealId: dto.dealId ?? null,
        conversationId: dto.conversationId ?? null,
      },
      include: TASK_INCLUDE,
    });
    await this.audit.log({
      action: AuditAction.TASK_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'task',
      targetId: created.id,
      metadata: {
        title: truncate(created.title, 120),
        priority: created.priority,
        source: 'human',
      },
      request: meta,
    });
    if (created.assigneeId) await this.notifyAssigned(tenant, created, created.assigneeId, meta);
    await this.emit(tenant, meta, 'task.created', taskEventPayload(created));
    return toTaskWithRelations(created);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateTaskRequest,
    meta: RequestMeta,
  ): Promise<TaskWithRelations> {
    const existing = await this.requireTask(tenant, id);
    await this.assertReferences(tenant, dto);
    if (dto.assigneeId !== undefined && dto.assigneeId !== existing.assigneeId) {
      if (dto.assigneeId) await this.refs.assertActiveMember(tenant, dto.assigneeId, 'assigneeId');
      TaskRules.assertCanSetAssignee(tenant, dto.assigneeId, existing.assigneeId);
    }
    // Cross-field rule must also hold against stored values: reminder never after due.
    const nextDue =
      dto.dueAt !== undefined ? (dto.dueAt ? new Date(dto.dueAt) : null) : existing.dueAt;
    const nextReminder =
      dto.reminderAt !== undefined
        ? dto.reminderAt
          ? new Date(dto.reminderAt)
          : null
        : existing.reminderAt;
    if (nextDue && nextReminder && nextReminder.getTime() > nextDue.getTime()) {
      throw AppException.validation('reminderAt must not be after dueAt', [
        { path: 'reminderAt', message: 'reminderAt must not be after dueAt', code: 'custom' },
      ]);
    }

    const data: Prisma.TaskUncheckedUpdateInput = {};
    const changed: string[] = [];
    const set = <K extends keyof Prisma.TaskUncheckedUpdateInput>(
      key: K,
      value: Prisma.TaskUncheckedUpdateInput[K],
      differs: boolean,
    ) => {
      if (!differs) return;
      data[key] = value;
      changed.push(key);
    };
    if (dto.title !== undefined) set('title', dto.title, dto.title !== existing.title);
    if (dto.description !== undefined)
      set('description', dto.description, dto.description !== existing.description);
    if (dto.priority !== undefined)
      set('priority', dto.priority, dto.priority !== existing.priority);
    if (dto.status !== undefined && dto.status !== existing.status) {
      set('status', dto.status, true);
      data.completedAt = null; // cancelled/open statuses never carry a completion time
    }
    if (dto.dueAt !== undefined)
      set('dueAt', nextDue, (nextDue?.getTime() ?? null) !== (existing.dueAt?.getTime() ?? null));
    if (dto.reminderAt !== undefined) {
      set('reminderAt', nextReminder, TaskRules.shouldResetReminder(existing, nextReminder));
      if (TaskRules.shouldResetReminder(existing, nextReminder)) data.reminderSentAt = null;
    }
    if (dto.assigneeId !== undefined)
      set('assigneeId', dto.assigneeId, dto.assigneeId !== existing.assigneeId);
    if (dto.leadId !== undefined) set('leadId', dto.leadId, dto.leadId !== existing.leadId);
    if (dto.contactId !== undefined)
      set('contactId', dto.contactId, dto.contactId !== existing.contactId);
    if (dto.dealId !== undefined) set('dealId', dto.dealId, dto.dealId !== existing.dealId);
    if (dto.conversationId !== undefined) {
      set('conversationId', dto.conversationId, dto.conversationId !== existing.conversationId);
    }
    if (changed.length === 0) return toTaskWithRelations(existing);

    const updated = await this.prisma.client.task.update({
      where: { id: existing.id },
      data,
      include: TASK_INCLUDE,
    });
    await this.audit.log({
      action: AuditAction.TASK_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'task',
      targetId: existing.id,
      metadata: { changes: changed },
      request: meta,
    });
    if (changed.includes('assigneeId') && updated.assigneeId) {
      await this.notifyAssigned(tenant, updated, updated.assigneeId, meta);
    }
    return toTaskWithRelations(updated);
  }

  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.client.task.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    if (result.count === 0) throw AppException.notFound('Task');
    await this.audit.log({
      action: AuditAction.TASK_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'task',
      targetId: id,
      request: meta,
    });
  }

  /** Marks a task done. Completing a task that is already done is a no-op that returns it unchanged. */
  async complete(tenant: TenantContext, id: string, meta: RequestMeta): Promise<TaskWithRelations> {
    const existing = await this.requireTask(tenant, id);
    const patch = TaskRules.completionData(existing, new Date());
    if (!patch) return toTaskWithRelations(existing);
    // Conditional claim: two concurrent completions emit one event.
    const claimed = await this.prisma.client.task.updateMany({
      where: { id: existing.id, organizationId: tenant.organizationId, status: { not: 'done' } },
      data: patch,
    });
    const updated = await this.requireTask(tenant, id);
    if (claimed.count === 1) {
      await this.audit.log({
        action: AuditAction.TASK_COMPLETED,
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        targetType: 'task',
        targetId: id,
        metadata: { from: existing.status },
        request: meta,
      });
      await this.emit(tenant, meta, 'task.completed', {
        ...taskEventPayload(updated),
        completedBy: tenant.userId,
        previousStatus: existing.status,
      });
    }
    return toTaskWithRelations(updated);
  }

  async reopen(tenant: TenantContext, id: string, meta: RequestMeta): Promise<TaskWithRelations> {
    const existing = await this.requireTask(tenant, id);
    const patch = TaskRules.reopenData(existing);
    if (!patch) return toTaskWithRelations(existing);
    const updated = await this.prisma.client.task.update({
      where: { id: existing.id },
      data: { ...patch, ...(existing.reminderAt ? { reminderSentAt: null } : {}) },
      include: TASK_INCLUDE,
    });
    await this.audit.log({
      action: AuditAction.TASK_REOPENED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'task',
      targetId: id,
      metadata: { from: existing.status },
      request: meta,
    });
    return toTaskWithRelations(updated);
  }

  /** Assigns (or unassigns with `null`) up to 100 tasks at once; ids outside the organization are reported as not found. */
  async bulkAssign(
    tenant: TenantContext,
    dto: BulkAssignTasksRequest,
    meta: RequestMeta,
  ): Promise<BulkAssignTasksResult> {
    if (dto.assigneeId) await this.refs.assertActiveMember(tenant, dto.assigneeId, 'assigneeId');
    const ids = [...new Set(dto.taskIds)];
    const found = await this.prisma.client.task.findMany({
      where: { id: { in: ids }, organizationId: tenant.organizationId },
      select: { id: true, assigneeId: true },
    });
    const foundIds = new Set(found.map((t) => t.id));
    const toChange = found.filter((t) => t.assigneeId !== dto.assigneeId).map((t) => t.id);
    const unchanged = found.filter((t) => t.assigneeId === dto.assigneeId).map((t) => t.id);
    if (toChange.length > 0) {
      await this.prisma.client.task.updateMany({
        where: { id: { in: toChange }, organizationId: tenant.organizationId },
        data: { assigneeId: dto.assigneeId },
      });
      await this.audit.log({
        action: AuditAction.TASK_BULK_ASSIGNED,
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        targetType: 'task',
        metadata: {
          assigneeId: dto.assigneeId,
          count: toChange.length,
          taskIds: toChange.slice(0, 100),
        },
        request: meta,
      });
      if (dto.assigneeId && dto.assigneeId !== tenant.userId) {
        await this.notifications.notify({
          organizationId: tenant.organizationId,
          userId: dto.assigneeId,
          type: 'task_assigned',
          title: truncate(`${toChange.length} task(s) assigned to you`, 200),
          body: `${toChange.length} task(s) were assigned to you.`,
          link: '/tasks',
          data: { taskIds: toChange.slice(0, 20), assignedBy: tenant.userId },
          requestId: meta.requestId,
        });
      }
    }
    return {
      updated: toChange.length,
      unchanged,
      notFound: ids.filter((id) => !foundIds.has(id)),
    };
  }

  // ---------------------------------------------------------------------------------------------

  private async requireTask(tenant: TenantContext, id: string): Promise<TaskRow> {
    const task = await this.prisma.client.task.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: TASK_INCLUDE,
    });
    if (!task) throw AppException.notFound('Task');
    return task;
  }

  private async assertReferences(
    tenant: TenantContext,
    dto: {
      leadId?: string | null;
      contactId?: string | null;
      dealId?: string | null;
      conversationId?: string | null;
    },
  ): Promise<void> {
    if (dto.leadId) await this.refs.assertLead(tenant, dto.leadId, 'leadId');
    if (dto.contactId) await this.refs.assertContact(tenant, dto.contactId, 'contactId');
    if (dto.dealId) await this.refs.assertDeal(tenant, dto.dealId, 'dealId');
    if (dto.conversationId)
      await this.refs.assertConversation(tenant, dto.conversationId, 'conversationId');
  }

  private async emit(
    tenant: TenantContext,
    meta: RequestMeta,
    event: TaskEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events?.emit(tenant.organizationId, event, payload, {
      actorUserId: tenant.userId,
      requestId: meta.requestId,
    });
  }

  /** Self-assignment is silent. */
  private async notifyAssigned(
    tenant: TenantContext,
    task: Pick<Task, 'id' | 'title'>,
    assigneeId: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (assigneeId === tenant.userId) return;
    const actor = await this.prisma.client.user.findUnique({
      where: { id: tenant.userId },
      select: { firstName: true, lastName: true },
    });
    const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : 'A teammate';
    await this.notifications.notify({
      organizationId: tenant.organizationId,
      userId: assigneeId,
      type: 'task_assigned',
      title: truncate(`Task assigned to you: ${task.title}`, 200),
      body: `${actorName} assigned you the task "${task.title}".`,
      link: '/tasks',
      data: { taskId: task.id, assignedBy: tenant.userId },
      requestId: meta.requestId,
    });
  }
}

/** Domain-event payload (ids and scalar facts only). `assigneeId` lets `send_notification` target the assignee. */
export function taskEventPayload(
  task: Pick<
    Task,
    | 'id'
    | 'title'
    | 'priority'
    | 'status'
    | 'assigneeId'
    | 'dueAt'
    | 'source'
    | 'leadId'
    | 'contactId'
    | 'dealId'
    | 'conversationId'
  >,
): Record<string, unknown> {
  return {
    taskId: task.id,
    title: task.title,
    priority: task.priority,
    status: task.status,
    assigneeId: task.assigneeId,
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    source: task.source,
    leadId: task.leadId,
    contactId: task.contactId,
    dealId: task.dealId,
    conversationId: task.conversationId,
  };
}

export function buildTaskWhere(
  tenant: Pick<TenantContext, 'organizationId' | 'userId'>,
  query: Partial<ListTasksQuery>,
  now: Date,
): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [];
  if (query.search) {
    const contains = { contains: query.search, mode: 'insensitive' as const };
    and.push({ OR: [{ title: contains }, { description: contains }] });
  }
  if (query.overdue) {
    and.push({ status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { lt: now } });
  }
  const due: Prisma.DateTimeNullableFilter = {};
  if (query.dueFrom) due.gte = new Date(query.dueFrom);
  if (query.dueTo) due.lt = new Date(query.dueTo);
  if (Object.keys(due).length > 0) and.push({ dueAt: due });
  const assigneeId = query.assigneeId === 'me' ? tenant.userId : query.assigneeId;
  return {
    organizationId: tenant.organizationId,
    ...(query.status ? { status: { in: query.status } } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.unassigned ? { assigneeId: null } : assigneeId ? { assigneeId } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.contactId ? { contactId: query.contactId } : {}),
    ...(query.dealId ? { dealId: query.dealId } : {}),
    ...(query.conversationId ? { conversationId: query.conversationId } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

function taskOrderBy(query: ListTasksQuery): Prisma.TaskOrderByWithRelationInput[] {
  const tiebreak: Prisma.TaskOrderByWithRelationInput = { createdAt: 'desc' };
  if (query.sortBy === 'dueAt') {
    return [{ dueAt: { sort: query.sortOrder, nulls: 'last' } }, tiebreak];
  }
  return [{ [query.sortBy]: query.sortOrder }, tiebreak];
}
