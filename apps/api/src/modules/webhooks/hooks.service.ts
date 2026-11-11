import {
  AuditAction,
  type InboundWebhookAccepted,
  QueueName,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '@hilatech/contracts';
import { type Prisma } from '@hilatech/database';
import { hashEndpointSecret, verifyInboundRequest } from '@hilatech/shared';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AuditService } from '../audit/audit.service';

export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret' as const;

export interface IngestRequest {
  organizationSlug: string;
  endpointSlug: string;
  rawBody: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  meta: RequestMeta;
}

const header = (h: IngestRequest['headers'], name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Hash used to burn the same CPU on unknown endpoints as on known ones (no existence oracle by timing). */
const DUMMY_HASH = hashEndpointSecret('hilatech-dummy-endpoint');

@Injectable()
export class HooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Public ingress. Every authentication failure (unknown organization, unknown endpoint, bad or missing
   * credentials) yields the same `401` so the route cannot be used to enumerate tenants or endpoints.
   */
  async ingest(req: IngestRequest): Promise<InboundWebhookAccepted> {
    const org = await this.prisma.client.organization.findFirst({
      where: { slug: req.organizationSlug, deletedAt: null },
      select: { id: true },
    });
    const endpoint = org
      ? await this.prisma.client.webhookEndpoint.findFirst({
          where: { organizationId: org.id, slug: req.endpointSlug },
        })
      : null;

    const auth = verifyInboundRequest({
      secretHash: endpoint?.secretHash ?? DUMMY_HASH,
      rawBody: req.rawBody,
      signatureHeader: header(req.headers, WEBHOOK_SIGNATURE_HEADER),
      timestampHeader: header(req.headers, WEBHOOK_TIMESTAMP_HEADER),
      secretHeader: header(req.headers, WEBHOOK_SECRET_HEADER),
    });
    if (!endpoint || !org || !auth.ok) {
      if (endpoint && org) {
        await this.audit.log({
          action: AuditAction.WEBHOOK_ENDPOINT_AUTH_FAILED,
          organizationId: org.id,
          targetType: 'webhook_endpoint',
          targetId: endpoint.id,
          metadata: { reason: auth.ok ? 'unknown' : auth.reason },
          request: req.meta,
        });
      }
      throw AppException.unauthorized('Invalid webhook credentials');
    }

    if (!endpoint.isEnabled) throw AppException.conflict('This webhook endpoint is disabled');
    if (!endpoint.workflowId)
      throw AppException.conflict('This webhook endpoint is not bound to a workflow');
    const workflow = await this.prisma.client.workflow.findFirst({
      where: { id: endpoint.workflowId, organizationId: org.id },
      select: { id: true, isEnabled: true },
    });
    if (!workflow) throw AppException.conflict('The bound workflow no longer exists');
    if (!workflow.isEnabled) throw AppException.conflict('The bound workflow is disabled');

    const input = (
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : { body: req.body ?? null }
    ) as Prisma.InputJsonObject;

    const execution = await this.prisma.client.workflowExecution.create({
      data: {
        organizationId: org.id,
        workflowId: workflow.id,
        status: 'queued',
        trigger: { type: 'webhook', endpointId: endpoint.id, authMethod: auth.method },
        input,
      },
      select: { id: true },
    });
    await this.prisma.client.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { receivedCount: { increment: 1 }, lastReceivedAt: new Date() },
    });
    await this.queue.enqueue(QueueName.AUTOMATION, {
      kind: 'execute',
      organizationId: org.id,
      workflowId: workflow.id,
      executionId: execution.id,
      idempotencyKey: `wf-exec-${execution.id}`,
      requestId: req.meta.requestId ?? undefined,
      enqueuedAt: new Date().toISOString(),
    });
    return { executionId: execution.id };
  }
}
