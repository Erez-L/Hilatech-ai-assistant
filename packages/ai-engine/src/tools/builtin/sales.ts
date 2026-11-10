import { Permission } from '@hilatech/contracts';
import { DomainError, createDealRow, ensureDefaultPipeline, moveDealRow } from '@hilatech/database';
import { z } from 'zod';

import type { ToolContext, ToolDefinition, ToolResult } from '../types';

const limitSchema = z.number().int().min(1).max(25).default(10);
const uuid = z.string().uuid();

function ok(summary: string, data: unknown): ToolResult {
  return { ok: true, summary, data };
}
function fail(summary: string, error = 'not_found'): ToolResult {
  return { ok: false, summary, error };
}

function serialise<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => {
      if (
        v &&
        typeof v === 'object' &&
        'toNumber' in (v as object) &&
        typeof (v as { toNumber: unknown }).toNumber === 'function'
      ) {
        return (v as { toNumber: () => number }).toNumber();
      }
      return v;
    }),
  ) as T;
}

const taskView = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  reminderAt: true,
  assigneeId: true,
  source: true,
  leadId: true,
  contactId: true,
  dealId: true,
  conversationId: true,
  createdAt: true,
} as const;

const dealView = {
  id: true,
  title: true,
  value: true,
  currency: true,
  status: true,
  pipelineId: true,
  stageId: true,
  ownerId: true,
  contactId: true,
  companyId: true,
  expectedCloseAt: true,
  closedAt: true,
  lostReason: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
  stage: { select: { id: true, name: true, kind: true } },
  pipeline: { select: { id: true, name: true } },
} as const;

async function isActiveMember(ctx: ToolContext, userId: string): Promise<boolean> {
  const m = await ctx.prisma.organizationMember.findFirst({
    where: { organizationId: ctx.organizationId, userId, status: 'active' },
    select: { userId: true },
  });
  return !!m;
}

async function actorCan(ctx: ToolContext, permission: string): Promise<boolean> {
  if (!ctx.userId) return false;
  const m = await ctx.prisma.organizationMember.findFirst({
    where: { organizationId: ctx.organizationId, userId: ctx.userId, status: 'active' },
    select: { role: { select: { permissions: true } } },
  });
  return !!m?.role.permissions.includes(permission);
}

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------

export const listTasksTool: ToolDefinition = {
  key: 'tasks.list',
  name: 'List tasks',
  description:
    'List tasks of the organization, optionally filtered by status, assignee (use "me" for the acting user), related lead/contact/deal or overdue.',
  category: 'tasks',
  riskLevel: 'read',
  requiredPermission: Permission.TASKS_READ,
  input: z.object({
    status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
    assigneeId: z.union([uuid, z.literal('me')]).optional(),
    leadId: uuid.optional(),
    contactId: uuid.optional(),
    dealId: uuid.optional(),
    overdue: z.boolean().optional(),
    limit: limitSchema,
  }),
  async execute(ctx, input) {
    if (input.assigneeId === 'me' && !ctx.userId) {
      return fail('"me" needs an acting user; this run has none', 'no_actor');
    }
    const assigneeId = input.assigneeId === 'me' ? (ctx.userId as string) : input.assigneeId;
    const rows = await ctx.prisma.task.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(input.status ? { status: input.status } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(input.leadId ? { leadId: input.leadId } : {}),
        ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.dealId ? { dealId: input.dealId } : {}),
        ...(input.overdue
          ? { status: { in: ['todo', 'in_progress'] }, dueAt: { lt: ctx.now() } }
          : {}),
      },
      select: taskView,
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: input.limit,
    });
    return ok(`${rows.length} task(s)`, serialise(rows));
  },
};

export const createTaskTool: ToolDefinition = {
  key: 'tasks.create',
  name: 'Create task',
  description:
    'Create a task (follow-up, to-do), optionally linked to a lead, contact, deal or conversation, with a due date and reminder. Assigned to the acting user unless an assignee is given.',
  category: 'tasks',
  riskLevel: 'write',
  requiredPermission: Permission.TASKS_CREATE,
  input: z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(5000).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      dueAt: z.string().datetime().optional(),
      reminderAt: z.string().datetime().optional(),
      assigneeId: uuid.optional(),
      leadId: uuid.optional(),
      contactId: uuid.optional(),
      dealId: uuid.optional(),
      conversationId: uuid.optional(),
    })
    .refine((v) => !v.reminderAt || !v.dueAt || new Date(v.reminderAt) <= new Date(v.dueAt), {
      message: 'reminderAt must not be after dueAt',
      path: ['reminderAt'],
    }),
  async execute(ctx, input) {
    const org = ctx.organizationId;
    const checks: Array<[string, string | undefined, () => Promise<unknown>]> = [
      ['Lead', input.leadId, () => ctx.prisma.lead.findFirst({ where: { id: input.leadId, organizationId: org, deletedAt: null }, select: { id: true } })],
      ['Contact', input.contactId, () => ctx.prisma.contact.findFirst({ where: { id: input.contactId, organizationId: org, deletedAt: null }, select: { id: true } })],
      ['Deal', input.dealId, () => ctx.prisma.deal.findFirst({ where: { id: input.dealId, organizationId: org }, select: { id: true } })],
      ['Conversation', input.conversationId, () => ctx.prisma.conversation.findFirst({ where: { id: input.conversationId, organizationId: org }, select: { id: true } })],
    ];
    for (const [label, id, lookup] of checks) {
      if (id && !(await lookup())) return fail(`${label} not found in this organization`, 'invalid_reference');
    }
    let assigneeId: string | null = input.assigneeId ?? ctx.userId;
    if (input.assigneeId && input.assigneeId !== ctx.userId) {
      if (!(await actorCan(ctx, Permission.TASKS_ASSIGN))) {
        return fail('Assigning a task to someone else requires the tasks:assign permission', 'forbidden');
      }
      if (!(await isActiveMember(ctx, input.assigneeId))) {
        return fail('Assignee is not an active member of this organization', 'invalid_reference');
      }
      assigneeId = input.assigneeId;
    }
    const task = await ctx.prisma.task.create({
      data: {
        organizationId: org,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
        assigneeId,
        createdById: ctx.userId,
        source: 'ai',
        leadId: input.leadId ?? null,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        conversationId: input.conversationId ?? null,
      },
      select: taskView,
    });
    return ok(`Created task "${task.title}"`, serialise(task));
  },
};

// ---------------------------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------------------------

export const listDealsTool: ToolDefinition = {
  key: 'deals.list',
  name: 'List deals',
  description:
    'List deals (sales opportunities) with their pipeline stage, optionally filtered by status, stage, owner ("me" = acting user), contact or text.',
  category: 'deals',
  riskLevel: 'read',
  requiredPermission: Permission.DEALS_READ,
  input: z.object({
    status: z.enum(['open', 'won', 'lost']).optional(),
    stageId: uuid.optional(),
    pipelineId: uuid.optional(),
    ownerId: z.union([uuid, z.literal('me')]).optional(),
    contactId: uuid.optional(),
    search: z.string().trim().min(1).max(200).optional(),
    limit: limitSchema,
  }),
  async execute(ctx, input) {
    if (input.ownerId === 'me' && !ctx.userId) {
      return fail('"me" needs an acting user; this run has none', 'no_actor');
    }
    const ownerId = input.ownerId === 'me' ? (ctx.userId as string) : input.ownerId;
    const rows = await ctx.prisma.deal.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.stageId ? { stageId: input.stageId } : {}),
        ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
        ...(ownerId ? { ownerId } : {}),
        ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.search
          ? {
              OR: [
                { title: { contains: input.search, mode: 'insensitive' } },
                { description: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: dealView,
      orderBy: { updatedAt: 'desc' },
      take: input.limit,
    });
    return ok(`${rows.length} deal(s)`, serialise(rows));
  },
};

export const createDealTool: ToolDefinition = {
  key: 'deals.create',
  name: 'Create deal',
  description:
    'Create a deal in a pipeline (default pipeline and its first open stage unless given). Owned by the acting user.',
  category: 'deals',
  riskLevel: 'write',
  requiredPermission: Permission.DEALS_CREATE,
  input: z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(5000).optional(),
    value: z.number().nonnegative().optional(),
    currency: z.string().trim().toUpperCase().length(3).default('USD'),
    pipelineId: uuid.optional(),
    stageId: uuid.optional(),
    contactId: uuid.optional(),
    companyId: uuid.optional(),
    expectedCloseAt: z.string().datetime().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  }),
  async execute(ctx, input) {
    const org = ctx.organizationId;
    if (input.contactId) {
      const c = await ctx.prisma.contact.findFirst({
        where: { id: input.contactId, organizationId: org, deletedAt: null },
        select: { id: true },
      });
      if (!c) return fail('Contact not found in this organization', 'invalid_reference');
    }
    if (input.companyId) {
      const c = await ctx.prisma.company.findFirst({
        where: { id: input.companyId, organizationId: org },
        select: { id: true },
      });
      if (!c) return fail('Company not found in this organization', 'invalid_reference');
    }
    let pipelineId = input.pipelineId;
    let stageId = input.stageId;
    if (stageId) {
      const stage = await ctx.prisma.pipelineStage.findFirst({
        where: { id: stageId, organizationId: org, ...(pipelineId ? { pipelineId } : {}) },
      });
      if (!stage) return fail('Stage not found in this pipeline', 'invalid_reference');
      pipelineId = stage.pipelineId;
    } else {
      if (pipelineId) {
        const p = await ctx.prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId: org }, select: { id: true } });
        if (!p) return fail('Pipeline not found in this organization', 'invalid_reference');
      } else {
        pipelineId = (await ensureDefaultPipeline(ctx.prisma, org)).id;
      }
      const first = await ctx.prisma.pipelineStage.findFirst({
        where: { pipelineId, organizationId: org, kind: 'open' },
        orderBy: { order: 'asc' },
      });
      if (!first) return fail('The pipeline has no open stage', 'invalid_state');
      stageId = first.id;
    }
    try {
      const created = await ctx.prisma.$transaction(async (tx) => {
        const { deal } = await createDealRow(
          tx,
          {
            organizationId: org,
            title: input.title,
            description: input.description ?? null,
            value: input.value ?? null,
            currency: input.currency,
            pipelineId: pipelineId as string,
            stageId: stageId as string,
            ownerId: ctx.userId,
            contactId: input.contactId ?? null,
            companyId: input.companyId ?? null,
            expectedCloseAt: input.expectedCloseAt ? new Date(input.expectedCloseAt) : null,
            tags: input.tags,
            now: ctx.now(),
          },
          { actorId: ctx.userId, by: 'ai', extra: { agentId: ctx.agentId, executionId: ctx.executionId } },
        );
        return tx.deal.findFirstOrThrow({ where: { id: deal.id }, select: dealView });
      });
      return ok(`Created deal "${created.title}" in stage ${created.stage.name}`, serialise(created));
    } catch (err) {
      if (err instanceof DomainError) return fail(err.message, err.code);
      throw err;
    }
  },
};

export const moveDealTool: ToolDefinition = {
  key: 'deals.move',
  name: 'Move deal',
  description:
    'Move a deal to another stage of its pipeline (by stage id or exact stage name). Moving to a won/lost stage closes the deal; a lost reason can be given.',
  category: 'deals',
  riskLevel: 'write',
  requiredPermission: Permission.DEALS_UPDATE,
  input: z
    .object({
      dealId: uuid,
      stageId: uuid.optional(),
      stageName: z.string().trim().min(1).max(80).optional(),
      lostReason: z.string().trim().max(500).optional(),
    })
    .refine((v) => !!v.stageId || !!v.stageName, { message: 'Give stageId or stageName', path: ['stageId'] }),
  async execute(ctx, input) {
    const org = ctx.organizationId;
    const deal = await ctx.prisma.deal.findFirst({
      where: { id: input.dealId, organizationId: org },
      select: { id: true, title: true, pipelineId: true },
    });
    if (!deal) return fail('Deal not found');
    const stage = await ctx.prisma.pipelineStage.findFirst({
      where: {
        organizationId: org,
        pipelineId: deal.pipelineId,
        ...(input.stageId ? { id: input.stageId } : { name: { equals: input.stageName, mode: 'insensitive' } }),
      },
    });
    if (!stage) return fail('Stage not found in the deal pipeline', 'invalid_reference');
    try {
      const result = await ctx.prisma.$transaction(
        (tx) =>
          moveDealRow(
            tx,
            {
              organizationId: org,
              dealId: deal.id,
              toStageId: stage.id,
              lostReason: input.lostReason ?? null,
              now: ctx.now(),
            },
            { actorId: ctx.userId, by: 'ai', extra: { agentId: ctx.agentId, executionId: ctx.executionId } },
          ),
        { timeout: 15_000 },
      );
      const row = await ctx.prisma.deal.findFirstOrThrow({ where: { id: deal.id }, select: dealView });
      return ok(
        result.stageChanged
          ? `Deal "${deal.title}" moved from ${result.fromStage.name} to ${stage.name}`
          : `Deal "${deal.title}" is already in ${stage.name}`,
        serialise(row),
      );
    } catch (err) {
      if (err instanceof DomainError) return fail(err.message, err.code);
      throw err;
    }
  },
};

export const salesTools: ToolDefinition[] = [
  listTasksTool,
  createTaskTool,
  listDealsTool,
  createDealTool,
  moveDealTool,
];
