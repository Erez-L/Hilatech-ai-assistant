import { z } from 'zod';
import { idSchema, paginationQuerySchema, sortOrderSchema, timestampsSchema } from './common';

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const contactSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    firstName: z.string(),
    lastName: z.string().nullable(),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
    company: z.string().nullable(),
    jobTitle: z.string().nullable(),
    tags: z.array(z.string()),
    notes: z.string().nullable(),
    customFields: z.record(z.string(), z.unknown()),
    ownerId: idSchema.nullable(),
  })
  .merge(timestampsSchema);
export type Contact = z.infer<typeof contactSchema>;

export const createContactSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(32).optional(),
  company: z.string().trim().max(120).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  notes: z.string().trim().max(5000).optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
  ownerId: idSchema.optional(),
});
export type CreateContactRequest = z.infer<typeof createContactSchema>;
export const updateContactSchema = createContactSchema.partial();
export type UpdateContactRequest = z.infer<typeof updateContactSchema>;

export const listContactsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
  ownerId: idSchema.optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'firstName', 'company']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export const LeadStatus = z.enum(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']);
export type LeadStatus = z.infer<typeof LeadStatus>;

export const LeadSource = z.enum([
  'website',
  'referral',
  'social',
  'email',
  'phone',
  'whatsapp',
  'event',
  'ai_assistant',
  'import',
  'other',
]);
export type LeadSource = z.infer<typeof LeadSource>;

export const leadSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    title: z.string(),
    status: LeadStatus,
    source: LeadSource,
    value: z.number().nullable(),
    currency: z.string().length(3),
    contactId: idSchema.nullable(),
    assigneeId: idSchema.nullable(),
    description: z.string().nullable(),
    tags: z.array(z.string()),
    customFields: z.record(z.string(), z.unknown()),
    expectedCloseDate: z.string().datetime().nullable(),
    convertedAt: z.string().datetime().nullable(),
    lostReason: z.string().nullable(),
  })
  .merge(timestampsSchema);
export type Lead = z.infer<typeof leadSchema>;

export const createLeadSchema = z.object({
  title: z.string().trim().min(1).max(160),
  status: LeadStatus.default('new'),
  source: LeadSource.default('other'),
  value: z.number().nonnegative().optional(),
  currency: z.string().trim().toUpperCase().length(3).default('USD'),
  contactId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  description: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  customFields: z.record(z.string(), z.unknown()).default({}),
  expectedCloseDate: z.string().datetime().optional(),
});
export type CreateLeadRequest = z.infer<typeof createLeadSchema>;
export const updateLeadSchema = createLeadSchema.partial().extend({
  lostReason: z.string().trim().max(500).optional(),
});
export type UpdateLeadRequest = z.infer<typeof updateLeadSchema>;

export const listLeadsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: LeadStatus.optional(),
  source: LeadSource.optional(),
  assigneeId: idSchema.optional(),
  contactId: idSchema.optional(),
  tag: z.string().trim().max(40).optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'value', 'expectedCloseDate', 'title'])
    .default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

export const leadNoteSchema = z.object({
  id: idSchema,
  leadId: idSchema,
  authorId: idSchema,
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type LeadNote = z.infer<typeof leadNoteSchema>;
export const createLeadNoteSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const LeadActivityType = z.enum([
  'created',
  'status_changed',
  'assigned',
  'note_added',
  'contact_linked',
  'value_changed',
  'converted',
  'updated',
]);
export const leadActivitySchema = z.object({
  id: idSchema,
  leadId: idSchema,
  actorId: idSchema.nullable(),
  type: LeadActivityType,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type LeadActivity = z.infer<typeof leadActivitySchema>;

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const ConversationStatus = z.enum(['open', 'pending', 'resolved', 'archived']);
export type ConversationStatus = z.infer<typeof ConversationStatus>;
export const ConversationChannel = z.enum(['web', 'email', 'whatsapp', 'phone', 'internal', 'api']);
export type ConversationChannel = z.infer<typeof ConversationChannel>;
export const MessageRole = z.enum(['customer', 'agent', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRole>;

export const conversationSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    subject: z.string().nullable(),
    status: ConversationStatus,
    channel: ConversationChannel,
    contactId: idSchema.nullable(),
    leadId: idSchema.nullable(),
    assigneeId: idSchema.nullable(),
    summary: z.string().nullable(),
    lastMessageAt: z.string().datetime().nullable(),
    messageCount: z.number().int().nonnegative(),
  })
  .merge(timestampsSchema);
export type Conversation = z.infer<typeof conversationSchema>;

export const createConversationSchema = z.object({
  subject: z.string().trim().max(200).optional(),
  channel: ConversationChannel.default('internal'),
  contactId: idSchema.optional(),
  leadId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  initialMessage: z.string().trim().min(1).max(20000).optional(),
});
export type CreateConversationRequest = z.infer<typeof createConversationSchema>;
export const updateConversationSchema = z.object({
  subject: z.string().trim().max(200).optional(),
  status: ConversationStatus.optional(),
  assigneeId: idSchema.nullable().optional(),
  contactId: idSchema.nullable().optional(),
  leadId: idSchema.nullable().optional(),
});
export type UpdateConversationRequest = z.infer<typeof updateConversationSchema>;

export const messageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  role: MessageRole,
  authorUserId: idSchema.nullable(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type Message = z.infer<typeof messageSchema>;
export const createMessageSchema = z.object({
  role: MessageRole.default('agent'),
  content: z.string().trim().min(1).max(20000),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CreateMessageRequest = z.infer<typeof createMessageSchema>;

export const listConversationsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: ConversationStatus.optional(),
  channel: ConversationChannel.optional(),
  assigneeId: idSchema.optional(),
  contactId: idSchema.optional(),
  sortBy: z.enum(['lastMessageAt', 'createdAt', 'updatedAt']).default('lastMessageAt'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
