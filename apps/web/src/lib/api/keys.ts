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
  dashboard: (orgId: string | null) => ['org', orgId, 'analytics', 'dashboard'] as const,
  notifications: (orgId: string | null, unread?: boolean) =>
    ['org', orgId, 'notifications', { unread }] as const,
};
