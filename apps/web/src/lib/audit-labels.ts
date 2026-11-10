import type { AuditLog } from '@hilatech/contracts';
import { enumLabel } from '@/i18n/enums';
import type { T } from '@/i18n/provider';

/** Plain-language labels for audit actions (resource.verb → sentence). */
export function describeAuditAction(action: string, t: T): string {
  return enumLabel(t, 'audit.action', action);
}

export function auditTone(action: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (action.startsWith('security.') || action.endsWith('_failed') || action.includes('reuse'))
    return 'danger';
  if (action.endsWith('.deleted') || action.endsWith('.removed') || action.endsWith('.revoked'))
    return 'warning';
  if (action.endsWith('.created') || action.endsWith('.joined') || action === 'auth.register')
    return 'success';
  if (action.startsWith('auth.')) return 'info';
  return 'neutral';
}

/** Short description of the target of an audit entry. */
export function describeAuditTarget(log: AuditLog, t: T): string | null {
  if (!log.targetType) return null;
  const meta = log.metadata ?? {};
  const name =
    (typeof meta.name === 'string' && meta.name) ||
    (typeof meta.email === 'string' && meta.email) ||
    (typeof meta.title === 'string' && meta.title) ||
    null;
  const type = enumLabel(t, 'audit.target', log.targetType);
  return name ? `${type} · ${name}` : type;
}
