import type { AuditLog } from '@hilatech/contracts';

/** Plain-language labels for audit actions (resource.verb → sentence). */
export function describeAuditAction(action: string): string {
  const map: Record<string, string> = {
    'auth.register': 'Registered an account',
    'auth.login': 'Signed in',
    'auth.login_failed': 'Failed sign-in attempt',
    'auth.logout': 'Signed out',
    'auth.refresh': 'Session refreshed',
    'auth.refresh_reuse_detected': 'Refresh token reuse detected',
    'auth.password_reset_requested': 'Requested a password reset',
    'auth.password_reset': 'Reset password',
    'auth.password_changed': 'Changed password',
    'auth.email_verified': 'Verified email',
    'organization.created': 'Created the organization',
    'organization.updated': 'Updated organization profile',
    'organization.settings_updated': 'Updated organization settings',
    'organization.deleted': 'Deleted the organization',
    'member.invited': 'Invited a member',
    'member.joined': 'Joined the organization',
    'member.updated': 'Updated a member',
    'member.removed': 'Removed a member',
    'invitation.revoked': 'Revoked an invitation',
    'role.created': 'Created a role',
    'role.updated': 'Updated a role',
    'role.deleted': 'Deleted a role',
    'lead.created': 'Created a lead',
    'lead.updated': 'Updated a lead',
    'lead.deleted': 'Deleted a lead',
    'contact.created': 'Created a contact',
    'contact.updated': 'Updated a contact',
    'contact.deleted': 'Deleted a contact',
    'conversation.created': 'Started a conversation',
    'conversation.updated': 'Updated a conversation',
    'ai.config_updated': 'Updated AI configuration',
    'agent.created': 'Created an agent',
    'agent.updated': 'Updated an agent',
    'agent.deleted': 'Deleted an agent',
    'agent.executed': 'Ran an agent',
    'security.permission_denied': 'Permission denied',
    'security.tenant_violation_attempt': 'Blocked cross-organization access attempt',
  };
  return map[action] ?? action.replace(/[._]/g, ' ');
}

export function auditTone(action: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (action.startsWith('security.') || action.endsWith('_failed') || action.includes('reuse')) return 'danger';
  if (action.endsWith('.deleted') || action.endsWith('.removed') || action.endsWith('.revoked')) return 'warning';
  if (action.endsWith('.created') || action.endsWith('.joined') || action === 'auth.register') return 'success';
  if (action.startsWith('auth.')) return 'info';
  return 'neutral';
}

/** Short description of the target of an audit entry. */
export function describeAuditTarget(log: AuditLog): string | null {
  if (!log.targetType) return null;
  const meta = log.metadata ?? {};
  const name =
    (typeof meta.name === 'string' && meta.name) ||
    (typeof meta.email === 'string' && meta.email) ||
    (typeof meta.title === 'string' && meta.title) ||
    null;
  return name ? `${log.targetType} · ${name}` : log.targetType;
}
