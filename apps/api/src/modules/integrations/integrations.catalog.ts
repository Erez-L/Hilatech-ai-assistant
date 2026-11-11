import {
  type IntegrationCatalogueEntry,
  type IntegrationConfig,
  type IntegrationKind,
  type IntegrationSecrets,
} from '@hilatech/contracts';

/**
 * What each integration kind can do in THIS release. Only `rest` and `n8n` perform real network calls
 * (connectivity tests, workflow `http_request` / `n8n_trigger`). `email`, `whatsapp` and `crm` are
 * configuration-only: credentials can be stored, but nothing is sent and no test can pass — the UI must
 * show them as "available only with a provider".
 */
export const INTEGRATION_CATALOGUE: readonly IntegrationCatalogueEntry[] = [
  {
    kind: 'rest',
    name: 'REST / Webhook',
    description:
      'Call any HTTPS API or webhook from workflows (http_request steps) with optional bearer, basic or header authentication.',
    providers: ['generic'],
    requiredSecrets: [],
    liveSupport: 'full',
  },
  {
    kind: 'n8n',
    name: 'n8n',
    description:
      'Hand events to n8n workflows through webhook triggers. Optional: the platform works without n8n.',
    providers: ['n8n'],
    requiredSecrets: [],
    liveSupport: 'full',
  },
  {
    kind: 'email',
    name: 'Email (SMTP)',
    description:
      'Configuration only in this release: no email is sent from workflows and the connection cannot be tested. Available only once a provider integration ships.',
    providers: ['smtp'],
    requiredSecrets: ['username', 'password'],
    liveSupport: 'planned',
  },
  {
    kind: 'whatsapp',
    name: 'WhatsApp Business',
    description:
      'Configuration only: requires an approved provider (Meta Cloud API or Twilio). Nothing is sent and no connection is simulated.',
    providers: ['meta_cloud_api', 'twilio'],
    requiredSecrets: ['accessToken'],
    liveSupport: 'planned',
  },
  {
    kind: 'crm',
    name: 'External CRM',
    description:
      'Configuration only: field mapping for HubSpot, Pipedrive, Salesforce or a generic CRM. No synchronisation runs in this release.',
    providers: ['hubspot', 'pipedrive', 'salesforce', 'generic'],
    requiredSecrets: ['apiKey'],
    liveSupport: 'planned',
  },
];

export function catalogueEntry(kind: IntegrationKind): IntegrationCatalogueEntry {
  return INTEGRATION_CATALOGUE.find((e) => e.kind === kind)!;
}

export function isLiveKind(kind: IntegrationKind): boolean {
  return catalogueEntry(kind).liveSupport === 'full';
}

/** Cross-field checks that depend on both config and secrets. Returns validation messages (empty = ok). */
export function secretProblems(
  config: IntegrationConfig,
  secrets: IntegrationSecrets,
): Array<{ path: string; message: string }> {
  const problems: Array<{ path: string; message: string }> = [];
  if (config.kind === 'rest') {
    if (config.authType === 'bearer' && !secrets.accessToken && !secrets.apiKey) {
      problems.push({
        path: 'secrets.accessToken',
        message: 'Bearer authentication needs accessToken (or apiKey)',
      });
    }
    if (config.authType === 'basic' && (!secrets.username || !secrets.password)) {
      problems.push({
        path: 'secrets.username',
        message: 'Basic authentication needs username and password',
      });
    }
    if (config.authType === 'header') {
      if (!config.authHeaderName)
        problems.push({
          path: 'config.authHeaderName',
          message: 'authHeaderName is required for header authentication',
        });
      if (!secrets.apiKey)
        problems.push({ path: 'secrets.apiKey', message: 'Header authentication needs apiKey' });
    }
  }
  return problems;
}
