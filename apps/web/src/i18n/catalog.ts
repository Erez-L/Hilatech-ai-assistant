import { en, type MessageKey } from './messages';
import type { T } from './provider';

const hasKey = (key: string): key is MessageKey => Object.prototype.hasOwnProperty.call(en, key);

/**
 * Agent tools and workflow templates are described by the API in English. The web app shows its own translated
 * text for the ones it knows (by key) and falls back to the API text for anything newer than this build.
 */
function catalogText(
  t: T,
  kind: 'tool' | 'template' | 'integration',
  key: string,
  field: 'name' | 'description',
  fallback: string,
): string {
  const messageKey = `catalog.${kind}.${key}.${field}`;
  return hasKey(messageKey) ? t(messageKey) : fallback;
}

export function toolText(t: T, tool: { key: string; name: string; description: string }) {
  return {
    name: catalogText(t, 'tool', tool.key, 'name', tool.name),
    description: catalogText(t, 'tool', tool.key, 'description', tool.description),
  };
}

export function templateText(t: T, template: { key: string; name: string; description: string }) {
  return {
    name: catalogText(t, 'template', template.key, 'name', template.name),
    description: catalogText(t, 'template', template.key, 'description', template.description),
  };
}

const REQUIREMENT_KEYS: Record<string, MessageKey> = {
  agentId: 'catalog.requirement.agent',
  'owner userId': 'catalog.requirement.owner',
  'n8n integration': 'catalog.requirement.n8n',
  'inbound webhook endpoint': 'catalog.requirement.inboundWebhook',
};

/** What a workflow template needs before it can run, in the user's language instead of field names. */
export function requirementLabel(t: T, requirement: string): string {
  const key = REQUIREMENT_KEYS[requirement];
  return key ? t(key) : requirement;
}

export function integrationText(t: T, entry: { kind: string; name: string; description: string }) {
  return {
    name: catalogText(t, 'integration', entry.kind, 'name', entry.name),
    description: catalogText(t, 'integration', entry.kind, 'description', entry.description),
  };
}
