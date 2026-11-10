import { Module } from '@nestjs/common';
import { AiRuntimeModule } from '../ai/ai-runtime.module';
import { AutomationModule } from '../automation/automation.module';
import { AutomationProcessor } from '../automation/automation.processor';
import { WebhookDeliveryProcessor } from '../automation/webhook-delivery.processor';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage/storage.module';
import { JOB_PROCESSORS, type AnyJobProcessor } from '../queue/job-processor';
import { AiTasksProcessor } from './ai-tasks/ai-tasks.processor';
import { AnalyticsProcessor } from './analytics/analytics.processor';
import {
  EMAIL_DRIVER,
  LogEmailDriver,
  SmtpEmailDriver,
  type EmailDriver,
} from './email/email-driver';
import { EmailProcessor } from './email/email.processor';
import { NotificationsProcessor } from './notifications/notifications.processor';
import { DocumentEvents } from './document-processing/document-events';
import { DocumentProcessingProcessor } from './document-processing/document-processing.processor';
import { ImportsProcessor } from './imports/imports.processor';
import { TasksProcessor } from './tasks/tasks.processor';
import { EmbeddingsProcessor } from './stubs/not-implemented.processor';

const PROCESSOR_CLASSES = [
  EmailProcessor,
  NotificationsProcessor,
  AnalyticsProcessor,
  DocumentProcessingProcessor,
  EmbeddingsProcessor,
  AiTasksProcessor,
  AutomationProcessor,
  WebhookDeliveryProcessor,
  TasksProcessor,
  ImportsProcessor,
];

@Module({
  imports: [PrismaModule, AiRuntimeModule, RedisModule, StorageModule, AutomationModule],
  providers: [
    LogEmailDriver,
    SmtpEmailDriver,
    DocumentEvents,
    {
      provide: EMAIL_DRIVER,
      useFactory: (env: WorkersEnv, log: LogEmailDriver, smtp: SmtpEmailDriver): EmailDriver =>
        env.EMAIL_DRIVER === 'smtp' ? smtp : log,
      inject: [WORKERS_ENV, LogEmailDriver, SmtpEmailDriver],
    },
    // Automation processors are provided (once) by AutomationModule and resolved through its exports.
    ...PROCESSOR_CLASSES.filter(
      (c) => c !== AutomationProcessor && c !== WebhookDeliveryProcessor,
    ),
    {
      provide: JOB_PROCESSORS,
      useFactory: (...processors: AnyJobProcessor[]): AnyJobProcessor[] => processors,
      inject: PROCESSOR_CLASSES,
    },
  ],
  exports: [JOB_PROCESSORS],
})
export class ProcessorsModule {}
