import {
  AuditAction,
  type CreateWebhookEndpointRequest,
  type CreateWebhookRequest,
  type ListWebhookDeliveriesQuery,
  QueueName,
  type UpdateWebhookEndpointRequest,
  type UpdateWebhookRequest,
  type Webhook as WebhookDto,
  type WebhookDelivery as WebhookDeliveryDto,
  type WebhookEndpoint as WebhookEndpointDto,
  type WebhookEndpointWithSecret,
  type WebhookWithSecret,
} from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import {
  SecretBox,
  SsrfError,
  generateOpaqueToken,
  hashEndpointSecret,
  resolveSafeTarget,
} from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { OutboundPolicyService } from '../../infrastructure/http/outbound-policy.service';
import { SecretBoxService } from '../../infrastructure/crypto/secret-box.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AuditService } from '../audit/audit.service';
import {
  toWebhook,
  toWebhookDelivery,
  toWebhookEndpoint,
} from './webhooks.mappers';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly secrets: SecretBoxService,
    private readonly outbound: OutboundPolicyService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Outbound subscriptions
  // ---------------------------------------------------------------------------------------------

  async list(tenant: TenantContext): Promise<WebhookDto[]> {
    const rows = await this.prisma.client.webhook.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toWebhook);
  }

  async get(tenant: TenantContext, id: string): Promise<WebhookDto> {
    return toWebhook(await this.requireWebhook(tenant, id));
  }

  async create(
    tenant: TenantContext,
    dto: CreateWebhookRequest,
    meta: RequestMeta,
  ): Promise<WebhookWithSecret> {
    await this.assertUrlAllowed(dto.url);
    const secret = `whsec_${generateOpaqueToken(24)}`;
    const created = await this.prisma.client.webhook.create({
      data: {
        organizationId: tenant.organizationId,
        url: dto.url,
        description: dto.description ?? null,
        events: dto.events,
        encryptedSecret: this.secrets.encrypt(tenant.organizationId, secret),
        secretLast4: SecretBox.last(secret, 4),
        isEnabled: dto.isEnabled,
      },
    });
    await this.audit.log({
      action: AuditAction.WEBHOOK_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'webhook',
      targetId: created.id,
      metadata: { url: dto.url, events: dto.events },
      request: meta,
    });
    return { ...toWebhook(created), secret };
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateWebhookRequest,
    meta: RequestMeta,
  ): Promise<WebhookDto> {
    const existing = await this.requireWebhook(tenant, id);
    if (dto.url !== undefined && dto.url !== existing.url) await this.assertUrlAllowed(dto.url);
    const updated = await this.prisma.client.webhook.update({
      where: { id: existing.id },
      data: {
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.events !== undefined ? { events: dto.events } : {}),
        ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
      },
    });
    await this.audit.log({
      action: AuditAction.WEBHOOK_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'webhook',
      targetId: existing.id,
      metadata: { changes: Object.keys(dto) },
      request: meta,
    });
    return toWebhook(updated);
  }

  /** New signing secret, returned exactly once. */
  async rotateSecret(tenant: TenantContext, id: string, meta: RequestMeta): Promise<WebhookWithSecret> {
    const existing = await this.requireWebhook(tenant, id);
    const secret = `whsec_${generateOpaqueToken(24)}`;
    const updated = await this.prisma.client.webhook.update({
      where: { id: existing.id },
      data: {
        encryptedSecret: this.secrets.encrypt(tenant.organizationId, secret),
        secretLast4: SecretBox.last(secret, 4),
      },
    });
    await this.audit.log({
      action: AuditAction.WEBHOOK_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'webhook',
      targetId: existing.id,
      metadata: { changes: ['secret'] },
      request: meta,
    });
    return { ...toWebhook(updated), secret };
  }

  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.client.webhook.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    if (result.count === 0) throw AppException.notFound('Webhook');
    await this.audit.log({
      action: AuditAction.WEBHOOK_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'webhook',
      targetId: id,
      request: meta,
    });
  }

  /** Queues a signed `webhook.test` delivery to the subscription URL (visible in the deliveries list). */
  async sendTest(tenant: TenantContext, id: string, meta: RequestMeta): Promise<WebhookDeliveryDto> {
    const webhook = await this.requireWebhook(tenant, id);
    const delivery = await this.prisma.client.webhookDelivery.create({
      data: {
        organizationId: tenant.organizationId,
        webhookId: webhook.id,
        event: 'webhook.test',
        payload: {
          message: 'This is a test delivery from HilaTech AI Assistant.',
          webhookId: webhook.id,
          triggeredBy: tenant.userId,
        },
        status: 'pending',
        nextAttemptAt: new Date(),
      },
    });
    await this.queue.enqueue(QueueName.WEBHOOK_DELIVERY, {
      organizationId: tenant.organizationId,
      deliveryId: delivery.id,
      attempt: 0,
      idempotencyKey: `whd-${delivery.id}-0`,
      requestId: meta.requestId ?? undefined,
      enqueuedAt: new Date().toISOString(),
    });
    await this.audit.log({
      action: AuditAction.WEBHOOK_TESTED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'webhook',
      targetId: webhook.id,
      metadata: { deliveryId: delivery.id },
      request: meta,
    });
    return toWebhookDelivery(delivery);
  }

  async listDeliveries(
    tenant: TenantContext,
    webhookId: string,
    query: ListWebhookDeliveriesQuery,
  ): Promise<PageResult<WebhookDeliveryDto>> {
    await this.requireWebhook(tenant, webhookId);
    const where: Prisma.WebhookDeliveryWhereInput = {
      organizationId: tenant.organizationId,
      webhookId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.event ? { event: query.event } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.webhookDelivery.count({ where }),
    ]);
    return page(rows.map(toWebhookDelivery), query, total);
  }

  // ---------------------------------------------------------------------------------------------
  // Inbound endpoints
  // ---------------------------------------------------------------------------------------------

  async listEndpoints(tenant: TenantContext): Promise<WebhookEndpointDto[]> {
    const [org, rows] = await Promise.all([
      this.organizationSlug(tenant.organizationId),
      this.prisma.client.webhookEndpoint.findMany({
        where: { organizationId: tenant.organizationId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return rows.map((r) => toWebhookEndpoint(r, org));
  }

  async getEndpoint(tenant: TenantContext, id: string): Promise<WebhookEndpointDto> {
    const row = await this.requireEndpoint(tenant, id);
    return toWebhookEndpoint(row, await this.organizationSlug(tenant.organizationId));
  }

  async createEndpoint(
    tenant: TenantContext,
    dto: CreateWebhookEndpointRequest,
    meta: RequestMeta,
  ): Promise<WebhookEndpointWithSecret> {
    if (dto.workflowId) await this.assertBindableWorkflow(tenant, dto.workflowId);
    const clash = await this.prisma.client.webhookEndpoint.findFirst({
      where: { organizationId: tenant.organizationId, slug: dto.slug },
      select: { id: true },
    });
    if (clash) throw AppException.conflict('An endpoint with this slug already exists');

    const secret = `whk_${generateOpaqueToken(32)}`;
    const created = await this.prisma.client.webhookEndpoint.create({
      data: {
        organizationId: tenant.organizationId,
        workflowId: dto.workflowId ?? null,
        name: dto.name,
        slug: dto.slug,
        secretHash: hashEndpointSecret(secret),
        isEnabled: dto.isEnabled,
      },
    });
    await this.audit.log({
      action: AuditAction.WEBHOOK_ENDPOINT_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'webhook_endpoint',
      targetId: created.id,
      metadata: { slug: created.slug, workflowId: created.workflowId },
      request: meta,
    });
    return { ...toWebhookEndpoint(created, await this.organizationSlug(tenant.organizationId)), secret };
  }

  async updateEndpoint(
    tenant: TenantContext,
    id: string,
    dto: UpdateWebhookEndpointRequest,
    meta: RequestMeta,
  ): Promise<WebhookEndpointDto> {
    const existing = await this.requireEndpoint(tenant, id);
    if (dto.workflowId && dto.workflowId !== existing.workflowId) {
      await this.assertBindableWorkflow(tenant, dto.workflowId);
    }
    const updated = await this.prisma.client.webhookEndpoint.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.workflowId !== undefined ? { workflowId: dto.workflowId } : {}),
        ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
      },
    });
    await this.audit.log({
      action: AuditAction.WEBHOOK_ENDPOINT_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'webhook_endpoint',
      targetId: existing.id,
      metadata: { changes: Object.keys(dto) },
      request: meta,
    });
    return toWebhookEndpoint(updated, await this.organizationSlug(tenant.organizationId));
  }

  async rotateEndpointSecret(
    tenant: TenantContext,
    id: string,
    meta: RequestMeta,
  ): Promise<WebhookEndpointWithSecret> {
    const existing = await this.requireEndpoint(tenant, id);
    const secret = `whk_${generateOpaqueToken(32)}`;
    const updated = await this.prisma.client.webhookEndpoint.update({
      where: { id: existing.id },
      data: { secretHash: hashEndpointSecret(secret) },
    });
    await this.audit.log({
      action: AuditAction.WEBHOOK_ENDPOINT_SECRET_ROTATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'webhook_endpoint',
      targetId: existing.id,
      request: meta,
    });
    return { ...toWebhookEndpoint(updated, await this.organizationSlug(tenant.organizationId)), secret };
  }

  async removeEndpoint(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.client.webhookEndpoint.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    if (result.count === 0) throw AppException.notFound('Webhook endpoint');
    await this.audit.log({
      action: AuditAction.WEBHOOK_ENDPOINT_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'webhook_endpoint',
      targetId: id,
      request: meta,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private async requireWebhook(tenant: TenantContext, id: string) {
    const row = await this.prisma.client.webhook.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('Webhook');
    return row;
  }

  private async requireEndpoint(tenant: TenantContext, id: string) {
    const row = await this.prisma.client.webhookEndpoint.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('Webhook endpoint');
    return row;
  }

  private async organizationSlug(organizationId: string): Promise<string> {
    const org = await this.prisma.client.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });
    if (!org) throw AppException.notFound('Organization');
    return org.slug;
  }

  /** The bound workflow must exist in this organization and use the `webhook` trigger. */
  private async assertBindableWorkflow(tenant: TenantContext, workflowId: string): Promise<void> {
    const workflow = await this.prisma.client.workflow.findFirst({
      where: { id: workflowId, organizationId: tenant.organizationId },
      select: { trigger: true },
    });
    if (!workflow) {
      throw AppException.validation('workflowId does not reference a workflow of this organization', [
        { path: 'workflowId', message: 'Workflow not found', code: 'custom' },
      ]);
    }
    if ((workflow.trigger as { type?: string }).type !== 'webhook') {
      throw AppException.validation('Only workflows with the "webhook" trigger can be bound to an endpoint', [
        { path: 'workflowId', message: 'Workflow trigger must be "webhook"', code: 'custom' },
      ]);
    }
  }

  /** Rejects literal private/loopback targets and hostnames that currently resolve to private addresses. */
  private async assertUrlAllowed(url: string): Promise<void> {
    try {
      await resolveSafeTarget(url, this.outbound.policy);
    } catch (error) {
      if (error instanceof SsrfError && error.reason === 'dns') return; // may be transient; re-checked on every delivery
      if (error instanceof SsrfError) {
        throw AppException.validation(`Webhook URL rejected: ${error.message}`, [
          { path: 'url', message: error.message, code: 'custom' },
        ]);
      }
      throw error;
    }
  }
}
