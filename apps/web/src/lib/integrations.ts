import type { IntegrationKind, IntegrationStatus } from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';
import { msg, type Msg } from '@/i18n/msg';

/** Kinds that can actually be connected in this release (the rest are configuration-only placeholders). */
export const CONNECTABLE_KINDS: readonly IntegrationKind[] = ['rest', 'n8n'];

export function isConnectable(kind: string, liveSupport?: string): boolean {
  return CONNECTABLE_KINDS.includes(kind as IntegrationKind) && liveSupport !== 'planned';
}

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, Msg> = {
  connected: msg('integrations.status.connected'),
  error: msg('integrations.status.error'),
  unconfigured: msg('integrations.status.unconfigured'),
};

export const INTEGRATION_STATUS_TONES: Record<IntegrationStatus, StatusTone> = {
  connected: 'success',
  error: 'danger',
  unconfigured: 'neutral',
};

export const SECRET_LABELS: Record<string, Msg> = {
  username: msg('integrations.secret.username'),
  password: msg('integrations.secret.password'),
  apiKey: msg('integrations.secret.apiKey'),
  accessToken: msg('integrations.secret.accessToken'),
  headers: msg('integrations.secret.headers'),
};

export const PLANNED_REQUIREMENTS: Record<string, Msg> = {
  email: msg('integrations.requires.email'),
  whatsapp: msg('integrations.requires.whatsapp'),
  crm: msg('integrations.requires.crm'),
};
