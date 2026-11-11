import {
  AuditAction,
  type CreateWorkflowRequest,
  type ListWorkflowExecutionsQuery,
  type ListWorkflowsQuery,
  QueueName,
  type RunWorkflowRequest,
  type UpdateWorkflowRequest,
  type ValidateWorkflowRequest,
  type Workflow as WorkflowDto,
  type WorkflowExecution as WorkflowExecutionDto,
  type WorkflowStep,
  type WorkflowTemplate,
  type WorkflowTrigger,
  type WorkflowValidationIssue,
  type WorkflowValidationResult,
  validateWorkflowDefinition,
} from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { WORKFLOW_TEMPLATES } from './workflow-templates';
import { toWorkflow, toWorkflowExecution } from './workflows.mappers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  // -- templates & validation -----------------------------------------------------------------------

  templates(): readonly WorkflowTemplate[] {
    return WORKFLOW_TEMPLATES;
  }

  /** Structural + reference validation, without storing anything. */
  async validate(
    tenant: TenantContext,
    definition: ValidateWorkflowRequest,
  ): Promise<WorkflowValidationResult> {
    const issues = await this.collectIssues(
      tenant.organizationId,
      definition.trigger,
      definition.steps,
    );
    return { valid: issues.length === 0, issues };
  }

  // -- CRUD ---------------------------------------------------------------------------------------

  async list(tenant: TenantContext, query: ListWorkflowsQuery): Promise<PageResult<WorkflowDto>> {
    const where: Prisma.WorkflowWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.triggerType ? { trigger: { path: ['type'], equals: query.triggerType } } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.workflow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.workflow.count({ where }),
    ]);
    return page(rows.map(toWorkflow), query, total);
  }

  async get(tenant: TenantContext, id: string): Promise<WorkflowDto> {
    return toWorkflow(await this.requireWorkflow(tenant, id));
  }

  async create(
    tenant: TenantContext,
    dto: CreateWorkflowRequest,
    meta: RequestMeta,
  ): Promise<WorkflowDto> {
    if (dto.isEnabled) await this.assertActivatable(tenant.organizationId, dto.trigger, dto.steps);
    await this.assertNameFree(tenant, dto.name);
    const created = await this.prisma.client.workflow.create({
      data: {
        organizationId: tenant.organizationId,
        name: dto.name,
        description: dto.description ?? null,
        isEnabled: dto.isEnabled,
        trigger: dto.trigger as unknown as Prisma.InputJsonObject,
        steps: dto.steps as unknown as Prisma.InputJsonArray,
        createdById: tenant.userId,
      },
    });
    await this.audit.log({
      action: AuditAction.WORKFLOW_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'workflow',
      targetId: created.id,
      metadata: {
        name: created.name,
        trigger: dto.trigger.type,
        isEnabled: created.isEnabled,
        steps: dto.steps.length,
      },
      request: meta,
    });
    return toWorkflow(created);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateWorkflowRequest,
    meta: RequestMeta,
  ): Promise<WorkflowDto> {
    const existing = await this.requireWorkflow(tenant, id);
    const next = {
      name: dto.name ?? existing.name,
      isEnabled: dto.isEnabled ?? existing.isEnabled,
      trigger: (dto.trigger ?? existing.trigger) as unknown as WorkflowTrigger,
      steps: (dto.steps ?? existing.steps) as unknown as WorkflowStep[],
    };
    if (next.isEnabled)
      await this.assertActivatable(tenant.organizationId, next.trigger, next.steps);
    if (dto.name && dto.name !== existing.name)
      await this.assertNameFree(tenant, dto.name, existing.id);

    const updated = await this.prisma.client.workflow.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
        ...(dto.trigger !== undefined
          ? { trigger: dto.trigger as unknown as Prisma.InputJsonObject }
          : {}),
        ...(dto.steps !== undefined
          ? { steps: dto.steps as unknown as Prisma.InputJsonArray }
          : {}),
      },
    });
    await this.audit.log({
      action: AuditAction.WORKFLOW_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'workflow',
      targetId: existing.id,
      metadata: { changes: Object.keys(dto), isEnabled: updated.isEnabled },
      request: meta,
    });
    return toWorkflow(updated);
  }

  async setEnabled(
    tenant: TenantContext,
    id: string,
    enabled: boolean,
    meta: RequestMeta,
  ): Promise<WorkflowDto> {
    return this.update(tenant, id, { isEnabled: enabled }, meta);
  }

  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.client.workflow.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    if (result.count === 0) throw AppException.notFound('Workflow');
    await this.audit.log({
      action: AuditAction.WORKFLOW_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'workflow',
      targetId: id,
      request: meta,
    });
  }

  // -- Runs ---------------------------------------------------------------------------------------

  /** Manual run: creates the execution (queued) and enqueues `automation.execute`. Disabled workflows cannot run. */
  async run(
    tenant: TenantContext,
    id: string,
    dto: RunWorkflowRequest,
    meta: RequestMeta,
  ): Promise<WorkflowExecutionDto> {
    const workflow = await this.requireWorkflow(tenant, id);
    if (!workflow.isEnabled) {
      throw AppException.conflict('This workflow is disabled; enable it before running it');
    }
    const issues = await this.collectIssues(
      tenant.organizationId,
      workflow.trigger as unknown as WorkflowTrigger,
      workflow.steps as unknown as WorkflowStep[],
    );
    if (issues.length > 0) throw this.invalid(issues);

    const execution = await this.prisma.client.workflowExecution.create({
      data: {
        organizationId: tenant.organizationId,
        workflowId: workflow.id,
        status: 'queued',
        trigger: { type: 'manual', actorUserId: tenant.userId },
        input: dto.input as Prisma.InputJsonObject,
      },
      include: { workflow: { select: { id: true, name: true } } },
    });
    await this.queue.enqueue(QueueName.AUTOMATION, {
      kind: 'execute',
      organizationId: tenant.organizationId,
      workflowId: workflow.id,
      executionId: execution.id,
      idempotencyKey: `wf-exec-${execution.id}`,
      requestId: meta.requestId ?? undefined,
      enqueuedAt: new Date().toISOString(),
    });
    await this.audit.log({
      action: AuditAction.WORKFLOW_RUN_REQUESTED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'workflow',
      targetId: workflow.id,
      metadata: { executionId: execution.id, trigger: 'manual' },
      request: meta,
    });
    return toWorkflowExecution(execution);
  }

  async listExecutions(
    tenant: TenantContext,
    query: ListWorkflowExecutionsQuery,
  ): Promise<PageResult<WorkflowExecutionDto>> {
    const where: Prisma.WorkflowExecutionWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.workflowId ? { workflowId: query.workflowId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.workflowExecution.findMany({
        where,
        include: { workflow: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.workflowExecution.count({ where }),
    ]);
    return page(rows.map(toWorkflowExecution), query, total);
  }

  async getExecution(tenant: TenantContext, id: string): Promise<WorkflowExecutionDto> {
    const row = await this.prisma.client.workflowExecution.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: { workflow: { select: { id: true, name: true } } },
    });
    if (!row) throw AppException.notFound('Workflow execution');
    return toWorkflowExecution(row);
  }

  // -- Internals ----------------------------------------------------------------------------------

  private async requireWorkflow(tenant: TenantContext, id: string) {
    const row = await this.prisma.client.workflow.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('Workflow');
    return row;
  }

  private async assertNameFree(
    tenant: TenantContext,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.client.workflow.findFirst({
      where: {
        organizationId: tenant.organizationId,
        name,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw AppException.conflict('A workflow with this name already exists');
  }

  private invalid(issues: WorkflowValidationIssue[]): AppException {
    return AppException.validation('The workflow definition is not valid', {
      issues,
    });
  }

  private async assertActivatable(
    organizationId: string,
    trigger: WorkflowTrigger,
    steps: readonly WorkflowStep[],
  ): Promise<void> {
    const issues = await this.collectIssues(organizationId, trigger, steps);
    if (issues.length > 0) throw this.invalid(issues);
  }

  /** Static validation plus checks that referenced resources exist in THIS organization. */
  async collectIssues(
    organizationId: string,
    trigger: WorkflowTrigger,
    steps: readonly WorkflowStep[],
  ): Promise<WorkflowValidationIssue[]> {
    const issues = validateWorkflowDefinition(trigger, steps);
    const add = (stepId: string, path: string, message: string) =>
      issues.push({ stepId, path, message });

    const literal = (v: string | undefined): string | null => (v && UUID_RE.test(v) ? v : null);
    const agentIds = new Set<string>();
    const userIds = new Set<string>();
    const roleKeys = new Set<string>();
    let needsN8n = false;
    for (const s of steps) {
      if (s.type === 'agent_run') agentIds.add(s.agentId);
      if (s.type === 'send_notification') {
        if (s.to.kind === 'user') userIds.add(s.to.userId);
        if (s.to.kind === 'role') roleKeys.add(s.to.roleKey);
      }
      if (s.type === 'update_lead') {
        const a = literal(s.assigneeId);
        if (a) userIds.add(a);
      }
      if (s.type === 'n8n_trigger') needsN8n = true;
    }

    const [agents, members, roles, n8n] = await Promise.all([
      agentIds.size
        ? this.prisma.client.agent.findMany({
            where: { organizationId, id: { in: [...agentIds] } },
            select: { id: true, isEnabled: true },
          })
        : [],
      userIds.size
        ? this.prisma.client.organizationMember.findMany({
            where: { organizationId, status: 'active', userId: { in: [...userIds] } },
            select: { userId: true },
          })
        : [],
      roleKeys.size
        ? this.prisma.client.role.findMany({
            where: { organizationId, key: { in: [...roleKeys] } },
            select: { key: true },
          })
        : [],
      needsN8n
        ? this.prisma.client.integration.count({
            where: { organizationId, kind: 'n8n', isEnabled: true },
          })
        : 1,
    ]);
    const agentById = new Map(agents.map((a) => [a.id, a]));
    const memberIds = new Set(members.map((m) => m.userId));
    const knownRoles = new Set(roles.map((r) => r.key));

    steps.forEach((s, i) => {
      const p = `steps[${i}]`;
      if (s.type === 'agent_run') {
        const agent = agentById.get(s.agentId);
        if (!agent) add(s.id, `${p}.agentId`, 'Agent not found in this organization');
        else if (!agent.isEnabled) add(s.id, `${p}.agentId`, 'Agent is disabled');
      }
      if (s.type === 'send_notification') {
        if (s.to.kind === 'user' && !memberIds.has(s.to.userId)) {
          add(s.id, `${p}.to.userId`, 'User is not an active member of this organization');
        }
        if (s.to.kind === 'role' && !knownRoles.has(s.to.roleKey)) {
          add(
            s.id,
            `${p}.to.roleKey`,
            `Role "${s.to.roleKey}" does not exist in this organization`,
          );
        }
      }
      if (s.type === 'update_lead') {
        const a = literal(s.assigneeId);
        if (a && !memberIds.has(a))
          add(s.id, `${p}.assigneeId`, 'Assignee is not an active member');
      }
      if (s.type === 'n8n_trigger' && n8n === 0) {
        add(s.id, p, 'No enabled n8n integration is connected for this organization');
      }
    });
    return issues;
  }
}
