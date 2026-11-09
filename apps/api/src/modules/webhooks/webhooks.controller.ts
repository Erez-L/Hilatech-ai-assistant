import {
  type CreateWebhookEndpointRequest,
  type CreateWebhookRequest,
  ErrorCode,
  type ListWebhookDeliveriesQuery,
  Permission,
  type UpdateWebhookEndpointRequest,
  type UpdateWebhookRequest,
  createWebhookEndpointSchema,
  createWebhookSchema,
  listWebhookDeliveriesQuerySchema,
  updateWebhookEndpointSchema,
  updateWebhookSchema,
  webhookDeliverySchema,
  webhookEndpointSchema,
  webhookEndpointWithSecretSchema,
  webhookSchema,
  webhookWithSecretSchema,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Req, RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestMeta } from '../../common/request';
import { WebhooksService } from './webhooks.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];

/** Outbound webhook subscriptions: HilaTech → your URL, HMAC-signed. */
@ApiTags('webhooks')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'List outbound webhook subscriptions (secrets are never returned)' })
  @ApiZodResponse(z.array(webhookSchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(@Tenant() tenant: TenantContext) {
    return this.webhooks.list(tenant);
  }

  @Post()
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a subscription. The signing secret is returned ONCE in `secret`' })
  @ApiZodBody(createWebhookSchema)
  @ApiZodResponse(webhookWithSecretSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createWebhookSchema)) body: CreateWebhookRequest,
    @Req() req: AppRequest,
  ) {
    return this.webhooks.create(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'Get a subscription' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(webhookSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.webhooks.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @ApiOperation({ summary: 'Update URL, events, description or enabled flag' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateWebhookSchema)
  @ApiZodResponse(webhookSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateWebhookSchema)) body: UpdateWebhookRequest,
    @Req() req: AppRequest,
  ) {
    return this.webhooks.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a subscription and its delivery history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.webhooks.remove(tenant, id, requestMeta(req));
  }

  @Post(':id/rotate-secret')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a new signing secret (returned once); the old one stops working' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(webhookWithSecretSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  rotate(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string, @Req() req: AppRequest) {
    return this.webhooks.rotateSecret(tenant, id, requestMeta(req));
  }

  @Post(':id/test')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue a signed `webhook.test` delivery; poll the deliveries list for the result' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(webhookDeliverySchema, { status: HttpStatus.ACCEPTED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  test(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string, @Req() req: AppRequest) {
    return this.webhooks.sendTest(tenant, id, requestMeta(req));
  }

  @Get(':id/deliveries')
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'Delivery attempts of a subscription, newest first' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(listWebhookDeliveriesQuerySchema)
  @ApiZodResponse(webhookDeliverySchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  deliveries(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(listWebhookDeliveriesQuerySchema)) query: ListWebhookDeliveriesQuery,
  ) {
    return this.webhooks.listDeliveries(tenant, id, query);
  }
}

/** Inbound webhook endpoints that trigger workflows (public URL: POST /hooks/:orgSlug/:slug). */
@ApiTags('webhooks')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('webhook-endpoints')
export class WebhookEndpointsController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'List inbound endpoints' })
  @ApiZodResponse(z.array(webhookEndpointSchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(@Tenant() tenant: TenantContext) {
    return this.webhooks.listEndpoints(tenant);
  }

  @Post()
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an inbound endpoint. The secret is returned ONCE in `secret`' })
  @ApiZodBody(createWebhookEndpointSchema)
  @ApiZodResponse(webhookEndpointWithSecretSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, CONFLICT)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createWebhookEndpointSchema)) body: CreateWebhookEndpointRequest,
    @Req() req: AppRequest,
  ) {
    return this.webhooks.createEndpoint(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'Get an inbound endpoint' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(webhookEndpointSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.webhooks.getEndpoint(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @ApiOperation({ summary: 'Rename, enable/disable or (re)bind to a workflow with a `webhook` trigger' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateWebhookEndpointSchema)
  @ApiZodResponse(webhookEndpointSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateWebhookEndpointSchema)) body: UpdateWebhookEndpointRequest,
    @Req() req: AppRequest,
  ) {
    return this.webhooks.updateEndpoint(tenant, id, body, requestMeta(req));
  }

  @Post(':id/rotate-secret')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a new endpoint secret (returned once)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(webhookEndpointWithSecretSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  rotate(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string, @Req() req: AppRequest) {
    return this.webhooks.rotateEndpointSecret(tenant, id, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an inbound endpoint' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.webhooks.removeEndpoint(tenant, id, requestMeta(req));
  }
}
