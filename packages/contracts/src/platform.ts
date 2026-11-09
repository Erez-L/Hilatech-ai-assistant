import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const AuditAction = {
  // auth
  AUTH_REGISTER: 'auth.register',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REFRESH: 'auth.refresh',
  AUTH_REFRESH_REUSE_DETECTED: 'auth.refresh_reuse_detected',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  AUTH_PASSWORD_RESET: 'auth.password_reset',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',
  AUTH_EMAIL_VERIFIED: 'auth.email_verified',
  // organization
  ORG_CREATED: 'organization.created',
  ORG_UPDATED: 'organization.updated',
  ORG_SETTINGS_UPDATED: 'organization.settings_updated',
  ORG_DELETED: 'organization.deleted',
  // members / roles / invitations
  MEMBER_INVITED: 'member.invited',
  MEMBER_JOINED: 'member.joined',
  MEMBER_UPDATED: 'member.updated',
  MEMBER_REMOVED: 'member.removed',
  INVITATION_REVOKED: 'invitation.revoked',
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',
  // crm
  LEAD_CREATED: 'lead.created',
  LEAD_UPDATED: 'lead.updated',
  LEAD_DELETED: 'lead.deleted',
  CONTACT_CREATED: 'contact.created',
  CONTACT_UPDATED: 'contact.updated',
  CONTACT_DELETED: 'contact.deleted',
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_UPDATED: 'conversation.updated',
  // ai
  AI_CONFIG_UPDATED: 'ai.config_updated',
  AGENT_CREATED: 'agent.created',
  AGENT_UPDATED: 'agent.updated',
  AGENT_DELETED: 'agent.deleted',
  AGENT_EXECUTED: 'agent.executed',
  // security
  PERMISSION_DENIED: 'security.permission_denied',
  TENANT_VIOLATION_ATTEMPT: 'security.tenant_violation_attempt',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const auditLogSchema = z.object({
  id: idSchema,
  organizationId: idSchema.nullable(),
  actorUserId: idSchema.nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(100).optional(),
  actorUserId: idSchema.optional(),
  targetType: z.string().max(60).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NotificationType = z.enum([
  'member_joined',
  'invitation_received',
  'lead_assigned',
  'conversation_assigned',
  'agent_execution_completed',
  'agent_execution_failed',
  'document_processed',
  'document_failed',
  'automation_failed',
  'system',
]);
export type NotificationType = z.infer<typeof NotificationType>;

export const notificationSchema = z.object({
  id: idSchema,
  organizationId: idSchema.nullable(),
  userId: idSchema,
  type: NotificationType,
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationPreferencesSchema = z.object({
  inApp: z.record(NotificationType, z.boolean()).optional(),
  email: z.record(NotificationType, z.boolean()).optional(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

// ---------------------------------------------------------------------------
// Billing / entitlements (architecture only — no real payments without credentials)
// ---------------------------------------------------------------------------

export const PlanKey = z.enum(['free', 'starter', 'pro', 'enterprise']);
export type PlanKey = z.infer<typeof PlanKey>;

export const SubscriptionStatus = z.enum([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const planLimitsSchema = z.object({
  seats: z.number().int().positive(),
  aiTokensPerMonth: z.number().int().nonnegative(),
  agents: z.number().int().nonnegative(),
  knowledgeDocuments: z.number().int().nonnegative(),
  storageMb: z.number().int().nonnegative(),
  automations: z.number().int().nonnegative(),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  free: {
    seats: 2,
    aiTokensPerMonth: 100_000,
    agents: 1,
    knowledgeDocuments: 10,
    storageMb: 100,
    automations: 2,
  },
  starter: {
    seats: 5,
    aiTokensPerMonth: 1_000_000,
    agents: 5,
    knowledgeDocuments: 100,
    storageMb: 1_024,
    automations: 10,
  },
  pro: {
    seats: 25,
    aiTokensPerMonth: 10_000_000,
    agents: 25,
    knowledgeDocuments: 1_000,
    storageMb: 10_240,
    automations: 100,
  },
  enterprise: {
    seats: 1_000,
    aiTokensPerMonth: 1_000_000_000,
    agents: 1_000,
    knowledgeDocuments: 100_000,
    storageMb: 1_048_576,
    automations: 10_000,
  },
};

export const subscriptionSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  plan: PlanKey,
  status: SubscriptionStatus,
  limits: planLimitsSchema,
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  provider: z.string().nullable(),
  providerSubscriptionId: z.string().nullable(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const UsageMetric = z.enum([
  'ai_tokens',
  'agent_executions',
  'documents',
  'storage_mb',
  'automation_runs',
]);
export type UsageMetric = z.infer<typeof UsageMetric>;

export const usageSummarySchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  metrics: z.record(UsageMetric, z.object({ used: z.number(), limit: z.number().nullable() })),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;
