import { Module } from '@nestjs/common';

import { HooksController } from './hooks.controller';
import { HooksService } from './hooks.service';
import { WebhookEndpointsController, WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/** Outbound subscriptions (`/webhooks`), inbound endpoints (`/webhook-endpoints`) and the public `/hooks/*` ingress. */
@Module({
  controllers: [WebhooksController, WebhookEndpointsController, HooksController],
  providers: [WebhooksService, HooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
