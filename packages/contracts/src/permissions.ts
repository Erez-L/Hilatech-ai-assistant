/**
 * Permission keys follow `resource:action`.
 * Roles are configurable per organization; these keys are the vocabulary roles are built from.
 * The backend's PermissionsGuard checks these; the frontend uses them to hide/disable UI.
 */
export const Permission = {
  // Organization
  ORG_READ: 'organization:read',
  ORG_UPDATE: 'organization:update',
  ORG_DELETE: 'organization:delete',
  ORG_BILLING_MANAGE: 'organization:billing:manage',

  // Members & roles
  MEMBERS_READ: 'members:read',
  MEMBERS_INVITE: 'members:invite',
  MEMBERS_UPDATE: 'members:update',
  MEMBERS_REMOVE: 'members:remove',
  ROLES_READ: 'roles:read',
  ROLES_MANAGE: 'roles:manage',

  // CRM
  LEADS_READ: 'leads:read',
  LEADS_CREATE: 'leads:create',
  LEADS_UPDATE: 'leads:update',
  LEADS_DELETE: 'leads:delete',
  LEADS_ASSIGN: 'leads:assign',
  CONTACTS_READ: 'contacts:read',
  CONTACTS_CREATE: 'contacts:create',
  CONTACTS_UPDATE: 'contacts:update',
  CONTACTS_DELETE: 'contacts:delete',
  CONVERSATIONS_READ: 'conversations:read',
  CONVERSATIONS_CREATE: 'conversations:create',
  CONVERSATIONS_UPDATE: 'conversations:update',
  CONVERSATIONS_ASSIGN: 'conversations:assign',

  // AI
  AI_ASSISTANT_USE: 'ai:assistant:use',
  AI_CONFIG_READ: 'ai:config:read',
  AI_CONFIG_MANAGE: 'ai:config:manage',
  AGENTS_READ: 'agents:read',
  AGENTS_MANAGE: 'agents:manage',
  AGENTS_EXECUTE: 'agents:execute',

  // Knowledge
  KNOWLEDGE_READ: 'knowledge:read',
  KNOWLEDGE_MANAGE: 'knowledge:manage',

  // Automation & integrations
  AUTOMATIONS_READ: 'automations:read',
  AUTOMATIONS_MANAGE: 'automations:manage',
  INTEGRATIONS_READ: 'integrations:read',
  INTEGRATIONS_MANAGE: 'integrations:manage',

  // Analytics, audit, notifications
  ANALYTICS_READ: 'analytics:read',
  AUDIT_READ: 'audit:read',
  NOTIFICATIONS_READ: 'notifications:read',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

/** System roles are created for every organization. They can be viewed but not deleted;
 *  `owner` permissions cannot be reduced. Organizations may add custom roles. */
export const SystemRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;
export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole];

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => p !== Permission.ORG_DELETE),
  member: [
    Permission.ORG_READ,
    Permission.MEMBERS_READ,
    Permission.ROLES_READ,
    Permission.LEADS_READ,
    Permission.LEADS_CREATE,
    Permission.LEADS_UPDATE,
    Permission.CONTACTS_READ,
    Permission.CONTACTS_CREATE,
    Permission.CONTACTS_UPDATE,
    Permission.CONVERSATIONS_READ,
    Permission.CONVERSATIONS_CREATE,
    Permission.CONVERSATIONS_UPDATE,
    Permission.AI_ASSISTANT_USE,
    Permission.AGENTS_READ,
    Permission.AGENTS_EXECUTE,
    Permission.KNOWLEDGE_READ,
    Permission.AUTOMATIONS_READ,
    Permission.INTEGRATIONS_READ,
    Permission.ANALYTICS_READ,
    Permission.NOTIFICATIONS_READ,
  ],
};

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
