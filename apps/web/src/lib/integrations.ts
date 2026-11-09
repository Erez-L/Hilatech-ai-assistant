import type { IntegrationKind, IntegrationStatus } from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';

/** Kinds that can actually be connected in this release (the rest are configuration-only placeholders). */
export const CONNECTABLE_KINDS: readonly IntegrationKind[] = ['rest', 'n8n'];

export function isConnectable(kind: string, liveSupport?: string): boolean {
  return CONNECTABLE_KINDS.includes(kind as IntegrationKind) && liveSupport !== 'planned';
}

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: 'Connected',
  error: 'Error',
  unconfigured: 'Not tested',
};

export const INTEGRATION_STATUS_TONES: Record<IntegrationStatus, StatusTone> = {
  connected: 'success',
  error: 'danger',
  unconfigured: 'neutral',
};

export const SECRET_LABELS: Record<string, string> = {
  username: 'Username',
  password: 'Password',
  apiKey: 'API key',
  accessToken: 'Access token',
  headers: 'Secret headers',
};

export const PLANNED_REQUIREMENTS: Record<string, string> = {
  email: 'Requires an email provider integration (SMTP delivery isn’t implemented yet).',
  whatsapp: 'Requires an approved provider: Meta Cloud API or Twilio.',
  crm: 'Requires a CRM provider: HubSpot, Pipedrive, Salesforce or a generic API.',
};
