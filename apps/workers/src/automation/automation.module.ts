import { Module } from '@nestjs/common';
import { AiRuntimeModule } from '../ai/ai-runtime.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { DomainEventPublisher } from './domain-event.publisher';
import { AutomationProcessor } from './automation.processor';
import { QueueProducer } from './queue-producer.service';
import { StepHandlerFactory } from './step-handlers';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';

/** Automation slice: workflow runner + fan-out + scheduler (`automation` queue) and `webhook-delivery`. */
@Module({
  imports: [PrismaModule, RedisModule, AiRuntimeModule],
  providers: [QueueProducer, DomainEventPublisher, StepHandlerFactory, AutomationProcessor, WebhookDeliveryProcessor],
  exports: [QueueProducer, DomainEventPublisher, AutomationProcessor, WebhookDeliveryProcessor],
})
export class AutomationModule {}
