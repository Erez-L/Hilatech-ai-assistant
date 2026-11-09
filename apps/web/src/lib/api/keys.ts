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

  // AI platform
  aiRoot: (orgId: string | null) => ['org', orgId, 'ai'] as const,
  aiProviders: (orgId: string | null) => ['org', orgId, 'ai', 'providers'] as const,
  aiModels: (orgId: string | null, provider?: string) =>
    ['org', orgId, 'ai', 'models', provider ?? 'all'] as const,
  aiUsage: (orgId: string | null, range?: object) =>
    ['org', orgId, 'ai', 'usage', range ?? {}] as const,
  aiPrompts: (orgId: string | null) => ['org', orgId, 'ai', 'prompts'] as const,
  aiTools: (orgId: string | null) => ['org', orgId, 'ai', 'tools'] as const,

  // Assistant
  assistantRoot: (orgId: string | null) => ['org', orgId, 'assistant'] as const,
  assistantThreads: (orgId: string | null, params?: object) =>
    ['org', orgId, 'assistant', 'threads', params ?? {}] as const,
  assistantMessages: (orgId: string | null, threadId: string) =>
    ['org', orgId, 'assistant', 'thread', threadId, 'messages'] as const,

  // Agents
  agentsRoot: (orgId: string | null) => ['org', orgId, 'agents'] as const,
  agents: (orgId: string | null, params?: object) =>
    ['org', orgId, 'agents', 'list', params ?? {}] as const,
  agent: (orgId: string | null, id: string) => ['org', orgId, 'agents', 'detail', id] as const,
  executions: (orgId: string | null, params?: object) =>
    ['org', orgId, 'agents', 'executions', 'list', params ?? {}] as const,
  execution: (orgId: string | null, id: string) =>
    ['org', orgId, 'agents', 'executions', 'detail', id] as const,
  // Knowledge
  knowledgeRoot: (orgId: string | null) => ['org', orgId, 'knowledge'] as const,
  knowledgeBases: (orgId: string | null, params?: object) =>
    ['org', orgId, 'knowledge', 'bases', 'list', params ?? {}] as const,
  knowledgeBase: (orgId: string | null, id: string) =>
    ['org', orgId, 'knowledge', 'bases', 'detail', id] as const,
  knowledgeDocuments: (orgId: string | null, baseId: string, params?: object) =>
    ['org', orgId, 'knowledge', 'bases', 'detail', baseId, 'documents', params ?? {}] as const,
  knowledgeChunks: (orgId: string | null, documentId: string, params?: object) =>
    ['org', orgId, 'knowledge', 'documents', documentId, 'chunks', params ?? {}] as const,

  // Automations
  automationsRoot: (orgId: string | null) => ['org', orgId, 'automations'] as const,
  workflows: (orgId: string | null, params?: object) =>
    ['org', orgId, 'automations', 'workflows', 'list', params ?? {}] as const,
  workflow: (orgId: string | null, id: string) =>
    ['org', orgId, 'automations', 'workflows', 'detail', id] as const,
  workflowTemplates: (orgId: string | null) => ['org', orgId, 'automations', 'templates'] as const,
  workflowExecutions: (orgId: string | null, params?: object) =>
    ['org', orgId, 'automations', 'executions', 'list', params ?? {}] as const,
  workflowExecution: (orgId: string | null, id: string) =>
    ['org', orgId, 'automations', 'executions', 'detail', id] as const,
  webhooks: (orgId: string | null) => ['org', orgId, 'automations', 'webhooks', 'list'] as const,
  webhookDeliveries: (orgId: string | null, id: string, params?: object) =>
    ['org', orgId, 'automations', 'webhooks', 'deliveries', id, params ?? {}] as const,
  webhookEndpoints: (orgId: string | null) =>
    ['org', orgId, 'automations', 'endpoints', 'list'] as const,

  // Integrations
  integrationsRoot: (orgId: string | null) => ['org', orgId, 'integrations'] as const,
  integrationCatalog: (orgId: string | null) => ['org', orgId, 'integrations', 'catalog'] as const,
  integrationStatus: (orgId: string | null) => ['org', orgId, 'integrations', 'status'] as const,
  integrations: (orgId: string | null) => ['org', orgId, 'integrations', 'list'] as const,
};
