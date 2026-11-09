/** Query-key factory. Tenant-scoped keys embed the organization id so switching organizations never shows stale data. */
export const keys = {
  session: (orgId: string | null) => ['session', orgId] as const,
  authSessions: () => ['auth', 'sessions'] as const,
  organizations: () => ['organizations'] as const,
  organization: (orgId: string | null) => ['org', orgId, 'organization'] as const,
  organizationSettings: (orgId: string | null) =>
    ['org', orgId, 'organization', 'settings'] as const,
  members: (orgId: string | null, params?: object) =>
    ['org', orgId, 'members', params ?? {}] as const,
  roles: (orgId: string | null) => ['org', orgId, 'roles'] as const,
  role: (orgId: string | null, id: string) => ['org', orgId, 'roles', id] as const,
  permissions: (orgId: string | null) => ['org', orgId, 'permissions'] as const,
  invitations: (orgId: string | null) => ['org', orgId, 'invitations'] as const,
  invitationPreview: (token: string) => ['invitations', 'preview', token] as const,
  auditLogs: (orgId: string | null, params?: object) =>
    ['org', orgId, 'audit-logs', params ?? {}] as const,
  subscription: (orgId: string | null) => ['org', orgId, 'billing', 'subscription'] as const,
  usage: (orgId: string | null) => ['org', orgId, 'billing', 'usage'] as const,
  plans: () => ['billing', 'plans'] as const,
  dashboard: (orgId: string | null, period?: string) =>
    period
      ? (['org', orgId, 'analytics', 'dashboard', period] as const)
      : (['org', orgId, 'analytics', 'dashboard'] as const),

  // Notifications
  notificationsRoot: (orgId: string | null) => ['org', orgId, 'notifications'] as const,
  notifications: (orgId: string | null, params?: object) =>
    ['org', orgId, 'notifications', 'list', params ?? {}] as const,
  notificationsUnreadCount: (orgId: string | null) =>
    ['org', orgId, 'notifications', 'unread-count'] as const,
  notificationPreferences: (orgId: string | null) =>
    ['org', orgId, 'notifications', 'preferences'] as const,

  // CRM — contacts
  contactsRoot: (orgId: string | null) => ['org', orgId, 'contacts'] as const,
  contacts: (orgId: string | null, params?: object) =>
    ['org', orgId, 'contacts', 'list', params ?? {}] as const,
  contact: (orgId: string | null, id: string) => ['org', orgId, 'contacts', 'detail', id] as const,
  contactTags: (orgId: string | null) => ['org', orgId, 'contacts', 'tags'] as const,

  // CRM — leads
  leadsRoot: (orgId: string | null) => ['org', orgId, 'leads'] as const,
  leads: (orgId: string | null, params?: object) =>
    ['org', orgId, 'leads', 'list', params ?? {}] as const,
  lead: (orgId: string | null, id: string) => ['org', orgId, 'leads', 'detail', id] as const,
  leadNotes: (orgId: string | null, id: string, params?: object) =>
    ['org', orgId, 'leads', 'detail', id, 'notes', params ?? {}] as const,
  leadActivities: (orgId: string | null, id: string, params?: object) =>
    ['org', orgId, 'leads', 'detail', id, 'activities', params ?? {}] as const,

  // CRM — conversations
  conversationsRoot: (orgId: string | null) => ['org', orgId, 'conversations'] as const,
  conversations: (orgId: string | null, params?: object) =>
    ['org', orgId, 'conversations', 'list', params ?? {}] as const,
  conversation: (orgId: string | null, id: string) =>
    ['org', orgId, 'conversations', 'detail', id] as const,
  messages: (orgId: string | null, conversationId: string) =>
    ['org', orgId, 'conversations', 'detail', conversationId, 'messages'] as const,
};
