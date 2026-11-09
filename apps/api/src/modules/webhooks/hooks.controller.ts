import { type InboundWebhookAccepted, inboundWebhookAcceptedSchema } from '@hilatech/contracts';
import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Public, Req, SkipTransform, WebhookThrottle } from '../../common/decorators';
import { ApiZodResponse } from '../../common/openapi/zod-openapi';
import { type AppRequest, requestMeta } from '../../common/request';
import { HooksService } from './hooks.service';

/**
 * Public inbound webhook ingress: `POST /api/v1/hooks/:organizationSlug/:endpointSlug`.
 * Authenticated by the endpoint secret (never by a user token) and rate limited per IP.
 */
@ApiTags('webhooks')
@Controller('hooks')
export class HooksController {
  constructor(private readonly hooks: HooksService) {}

  @Post(':organizationSlug/:endpointSlug')
  @Public()
  @WebhookThrottle()
  @SkipTransform()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Inbound webhook. Authenticate with `x-hilatech-signature: sha256=<hmac>` (key = SHA-256(secret) hex, over the raw body; ' +
      'optionally with `x-hilatech-timestamp` signing `<ts>.<body>`) or `x-webhook-secret: <secret>`. Responds `202 { executionId }`.',
  })
  @ApiParam({ name: 'organizationSlug' })
  @ApiParam({ name: 'endpointSlug' })
  @ApiZodResponse(inboundWebhookAcceptedSchema, { status: HttpStatus.ACCEPTED })
  receive(
    @Param('organizationSlug') organizationSlug: string,
    @Param('endpointSlug') endpointSlug: string,
    @Body() body: unknown,
    @Req() req: AppRequest & { rawBody?: Buffer },
  ): Promise<InboundWebhookAccepted> {
    return this.hooks.ingest({
      organizationSlug,
      endpointSlug,
      rawBody: req.rawBody ? req.rawBody.toString('utf8') : '',
      body,
      headers: req.headers,
      meta: requestMeta(req),
    });
  }
}
