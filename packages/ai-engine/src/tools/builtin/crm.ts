import { LeadSource, LeadStatus, Permission } from '@hilatech/contracts';
import { z } from 'zod';

import type { ToolContext, ToolDefinition, ToolResult } from '../types';

const limitSchema = z.number().int().min(1).max(25).default(10);

function ok(summary: string, data: unknown): ToolResult {
  return { ok: true, summary, data };
}
function fail(summary: string, error = 'not_found'): ToolResult {
  return { ok: false, summary, error };
}

const contactView = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  company: true,
  jobTitle: true,
  tags: true,
  createdAt: true,
} as const;

const leadView = {
  id: true,
  title: true,
  status: true,
  source: true,
  value: true,
  currency: true,
  contactId: true,
  assigneeId: true,
  expectedCloseDate: true,
  createdAt: true,
  updatedAt: true,
  contact: { select: { id: true, firstName: true, lastName: true, company: true } },
} as const;

function serialise<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => {
      if (v && typeof v === 'object' && 'toNumber' in (v as object) && typeof (v as { toNumber: unknown }).toNumber === 'function') {
        return (v as { toNumber: () => number }).toNumber();
      }
      return v;
    }),
  ) as T;
}

export const searchContactsTool: ToolDefinition = {
  key: 'crm.search_contacts',
  name: 'Search contacts',
  description: 'Find contacts of the organization by name, email, phone or company.',
  category: 'crm',
  riskLevel: 'read',
  requiredPermission: Permission.CONTACTS_READ,
  input: z.object({ query: z.string().trim().min(1).max(200), limit: limitSchema }),
  async execute(ctx, input) {
    const q = input.query;
    const rows = await ctx.prisma.contact.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { company: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: contactView,
      orderBy: { updatedAt: 'desc' },
      take: input.limit,
    });
    return ok(`${rows.length} contact(s) matched "${q}"`, serialise(rows));
  },
};

export const getContactTool: ToolDefinition = {
  key: 'crm.get_contact',
  name: 'Get contact',
  description: 'Load one contact with its recent leads and conversations.',
  category: 'crm',
  riskLevel: 'read',
  requiredPermission: Permission.CONTACTS_READ,
  input: z.object({ contactId: z.string().uuid() }),
  async execute(ctx, input) {
    const contact = await ctx.prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: ctx.organizationId, deletedAt: null },
      select: {
        ...contactView,
        notes: true,
        leads: { where: { deletedAt: null }, select: { id: true, title: true, status: true, value: true, currency: true }, take: 10, orderBy: { updatedAt: 'desc' } },
        conversations: { select: { id: true, subject: true, status: true, channel: true, lastMessageAt: true }, take: 10, orderBy: { lastMessageAt: 'desc' } },
      },
    });
    if (!contact) return fail('Contact not found');
    return ok(`Loaded contact ${contact.firstName} ${contact.lastName ?? ''}`.trim(), serialise(contact));
  },
};

export const createContactTool: ToolDefinition = {
  key: 'crm.create_contact',
  name: 'Create contact',
  description: 'Create a new contact in the organization address book.',
  category: 'crm',
  riskLevel: 'write',
  requiredPermission: Permission.CONTACTS_CREATE,
  input: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().max(32).optional(),
    company: z.string().trim().max(120).optional(),
    jobTitle: z.string().trim().max(120).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  }),
  async execute(ctx, input) {
    const row = await ctx.prisma.contact.create({
      data: { ...input, organizationId: ctx.organizationId, ownerId: ctx.userId ?? undefined },
      select: contactView,
    });
    return ok(`Created contact ${row.firstName} ${row.lastName ?? ''}`.trim(), serialise(row));
  },
};

export const searchLeadsTool: ToolDefinition = {
  key: 'crm.search_leads',
  name: 'Search leads',
  description: 'List leads, optionally filtered by text, status or assignee. Returns the most recently updated first.',
  category: 'crm',
  riskLevel: 'read',
  requiredPermission: Permission.LEADS_READ,
  input: z.object({
    query: z.string().trim().max(200).optional(),
    status: LeadStatus.optional(),
    assignedToMe: z.boolean().default(false),
    limit: limitSchema,
  }),
  async execute(ctx, input) {
    const rows = await ctx.prisma.lead.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(input.status ? { status: input.status } : {}),
        ...(input.assignedToMe && ctx.userId ? { assigneeId: ctx.userId } : {}),
        ...(input.query
          ? {
              OR: [
                { title: { contains: input.query, mode: 'insensitive' } },
                { description: { contains: input.query, mode: 'insensitive' } },
                { contact: { is: { OR: [{ firstName: { contains: input.query, mode: 'insensitive' } }, { lastName: { contains: input.query, mode: 'insensitive' } }, { company: { contains: input.query, mode: 'insensitive' } }] } } },
              ],
            }
          : {}),
      },
      select: leadView,
      orderBy: { updatedAt: 'desc' },
      take: input.limit,
    });
    return ok(`${rows.length} lead(s) found`, serialise(rows));
  },
};

export const getLeadTool: ToolDefinition = {
  key: 'crm.get_lead',
  name: 'Get lead',
  description: 'Load one lead with its contact, latest notes and recent activity.',
  category: 'crm',
  riskLevel: 'read',
  requiredPermission: Permission.LEADS_READ,
  input: z.object({ leadId: z.string().uuid() }),
  async execute(ctx, input) {
    const lead = await ctx.prisma.lead.findFirst({
      where: { id: input.leadId, organizationId: ctx.organizationId, deletedAt: null },
      select: {
        ...leadView,
        description: true,
        tags: true,
        lostReason: true,
        notes: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 },
        activities: { select: { type: true, payload: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!lead) return fail('Lead not found');
    return ok(`Loaded lead "${lead.title}"`, serialise(lead));
  },
};

export const createLeadTool: ToolDefinition = {
  key: 'crm.create_lead',
  name: 'Create lead',
  description: 'Create a new sales lead, optionally linked to an existing contact.',
  category: 'crm',
  riskLevel: 'write',
  requiredPermission: Permission.LEADS_CREATE,
  input: z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(5000).optional(),
    contactId: z.string().uuid().optional(),
    value: z.number().nonnegative().optional(),
    currency: z.string().trim().toUpperCase().length(3).default('USD'),
    source: LeadSource.default('ai_assistant'),
  }),
  async execute(ctx, input) {
    if (input.contactId) {
      const contact = await ctx.prisma.contact.findFirst({ where: { id: input.contactId, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } });
      if (!contact) return fail('Contact not found in this organization', 'invalid_reference');
    }
    const lead = await ctx.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          organizationId: ctx.organizationId,
          title: input.title,
          description: input.description,
          contactId: input.contactId,
          value: input.value,
          currency: input.currency,
          source: input.source,
          assigneeId: ctx.userId ?? undefined,
        },
        select: leadView,
      });
      await tx.leadActivity.create({
        data: { leadId: created.id, actorId: ctx.userId, type: 'created', payload: { by: 'ai', agentId: ctx.agentId, executionId: ctx.executionId } },
      });
      return created;
    });
    return ok(`Created lead "${lead.title}"`, serialise(lead));
  },
};

export const updateLeadStatusTool: ToolDefinition = {
  key: 'crm.update_lead_status',
  name: 'Update lead status',
  description: 'Move a lead to another pipeline status (new, contacted, qualified, proposal, won, lost).',
  category: 'crm',
  riskLevel: 'write',
  requiredPermission: Permission.LEADS_UPDATE,
  input: z.object({ leadId: z.string().uuid(), status: LeadStatus, lostReason: z.string().trim().max(500).optional() }),
  async execute(ctx, input) {
    const existing = await ctx.prisma.lead.findFirst({ where: { id: input.leadId, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true, status: true, title: true } });
    if (!existing) return fail('Lead not found');
    if (existing.status === input.status) return ok(`Lead "${existing.title}" is already ${input.status}`, { id: existing.id, status: existing.status });
    const updated = await ctx.prisma.$transaction(async (tx) => {
      const row = await tx.lead.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          ...(input.status === 'lost' && input.lostReason ? { lostReason: input.lostReason } : {}),
          ...(input.status === 'won' ? { convertedAt: ctx.now() } : {}),
        },
        select: leadView,
      });
      await tx.leadActivity.create({
        data: {
          leadId: existing.id,
          actorId: ctx.userId,
          type: 'status_changed',
          payload: { from: existing.status, to: input.status, by: 'ai', agentId: ctx.agentId, executionId: ctx.executionId },
        },
      });
      return row;
    });
    return ok(`Lead "${existing.title}" moved from ${existing.status} to ${input.status}`, serialise(updated));
  },
};

export const addLeadNoteTool: ToolDefinition = {
  key: 'crm.add_lead_note',
  name: 'Add lead note',
  description: 'Append a note to a lead (e.g. a summary of a call or a next step).',
  category: 'crm',
  riskLevel: 'write',
  requiredPermission: Permission.LEADS_UPDATE,
  input: z.object({ leadId: z.string().uuid(), body: z.string().trim().min(1).max(5000) }),
  async execute(ctx, input) {
    if (!ctx.userId) return fail('Notes require a human author; this run has no acting user', 'no_actor');
    const lead = await ctx.prisma.lead.findFirst({ where: { id: input.leadId, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true, title: true } });
    if (!lead) return fail('Lead not found');
    const note = await ctx.prisma.$transaction(async (tx) => {
      const created = await tx.leadNote.create({ data: { leadId: lead.id, authorId: ctx.userId as string, body: input.body }, select: { id: true, body: true, createdAt: true } });
      await tx.leadActivity.create({ data: { leadId: lead.id, actorId: ctx.userId, type: 'note_added', payload: { noteId: created.id, by: 'ai', agentId: ctx.agentId } } });
      return created;
    });
    return ok(`Added a note to lead "${lead.title}"`, serialise(note));
  },
};

export const listConversationsTool: ToolDefinition = {
  key: 'crm.list_conversations',
  name: 'List conversations',
  description: 'List customer conversations, optionally filtered by status, contact or lead.',
  category: 'crm',
  riskLevel: 'read',
  requiredPermission: Permission.CONVERSATIONS_READ,
  input: z.object({
    status: z.enum(['open', 'pending', 'resolved', 'archived']).optional(),
    contactId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    limit: limitSchema,
  }),
  async execute(ctx, input) {
    const rows = await ctx.prisma.conversation.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.leadId ? { leadId: input.leadId } : {}),
      },
      select: { id: true, subject: true, status: true, channel: true, contactId: true, leadId: true, assigneeId: true, summary: true, lastMessageAt: true, messageCount: true },
      orderBy: { lastMessageAt: 'desc' },
      take: input.limit,
    });
    return ok(`${rows.length} conversation(s)`, serialise(rows));
  },
};

export const getConversationMessagesTool: ToolDefinition = {
  key: 'crm.get_conversation_messages',
  name: 'Get conversation messages',
  description: 'Read the latest messages of a customer conversation (newest last).',
  category: 'crm',
  riskLevel: 'read',
  requiredPermission: Permission.CONVERSATIONS_READ,
  input: z.object({ conversationId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(20) }),
  async execute(ctx, input) {
    const conversation = await ctx.prisma.conversation.findFirst({ where: { id: input.conversationId, organizationId: ctx.organizationId }, select: { id: true, subject: true, status: true } });
    if (!conversation) return fail('Conversation not found');
    const messages = await ctx.prisma.message.findMany({
      where: { conversationId: conversation.id },
      select: { id: true, role: true, content: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
    });
    return ok(`${messages.length} message(s) from "${conversation.subject ?? 'conversation'}"`, serialise({ conversation, messages: messages.reverse() }));
  },
};

export const crmTools: ToolDefinition[] = [
  searchContactsTool,
  getContactTool,
  createContactTool,
  searchLeadsTool,
  getLeadTool,
  createLeadTool,
  updateLeadStatusTool,
  addLeadNoteTool,
  listConversationsTool,
  getConversationMessagesTool,
];

export type { ToolContext };
