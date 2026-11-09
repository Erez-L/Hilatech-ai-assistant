import {
  type DomainEvent,
  type Webhook as WebhookDto,
  type WebhookDelivery as WebhookDeliveryDto,
  type WebhookEndpoint as WebhookEndpointDto,
  API_PREFIX,
} from '@hilatech/contracts';
import {
  type Webhook,
  type WebhookDelivery,
  type WebhookEndpoint,
} from '@hilatech/database';

export function toWebhook(row: Webhook): WebhookDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    url: row.url,
    description: row.description,
    events: row.events as DomainEvent[],
    secretLast4: row.secretLast4,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWebhookDelivery(row: WebhookDelivery): WebhookDeliveryDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    webhookId: row.webhookId,
    event: row.event,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function endpointPath(organizationSlug: string, slug: string): string {
  return `${API_PREFIX}/hooks/${organizationSlug}/${slug}`;
}

export function toWebhookEndpoint(row: WebhookEndpoint, organizationSlug: string): WebhookEndpointDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workflowId: row.workflowId,
    name: row.name,
    slug: row.slug,
    isEnabled: row.isEnabled,
    receivedCount: row.receivedCount,
    lastReceivedAt: row.lastReceivedAt?.toISOString() ?? null,
    path: endpointPath(organizationSlug, row.slug),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
