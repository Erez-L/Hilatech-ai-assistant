import { Module } from '@nestjs/common';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { PrismaModule } from '../prisma/prisma.module';
import { JOB_PROCESSORS, type AnyJobProcessor } from '../queue/job-processor';
import { AnalyticsProcessor } from './analytics/analytics.processor';
import {
  EMAIL_DRIVER,
  LogEmailDriver,
  SmtpEmailDriver,
  type EmailDriver,
} from './email/email-driver';
import { EmailProcessor } from './email/email.processor';
import { NotificationsProcessor } from './notifications/notifications.processor';
import {
  AiTasksProcessor,
  AutomationProcessor,
  DocumentProcessingProcessor,
  EmbeddingsProcessor,
  WebhookDeliveryProcessor,
} from './stubs/not-implemented.processor';

const PROCESSOR_CLASSES = [
  EmailProcessor,
  NotificationsProcessor,
  AnalyticsProcessor,
  DocumentProcessingProcessor,
  EmbeddingsProcessor,
  AiTasksProcessor,
  AutomationProcessor,
  WebhookDeliveryProcessor,
];

@Module({
  imports: [PrismaModule],
  providers: [
    LogEmailDriver,
    SmtpEmailDriver,
    {
      provide: EMAIL_DRIVER,
      useFactory: (env: WorkersEnv, log: LogEmailDriver, smtp: SmtpEmailDriver): EmailDriver =>
        env.EMAIL_DRIVER === 'smtp' ? smtp : log,
      inject: [WORKERS_ENV, LogEmailDriver, SmtpEmailDriver],
    },
    ...PROCESSOR_CLASSES,
    {
      provide: JOB_PROCESSORS,
      useFactory: (...processors: AnyJobProcessor[]): AnyJobProcessor[] => processors,
      inject: PROCESSOR_CLASSES,
    },
  ],
  exports: [JOB_PROCESSORS],
})
export class ProcessorsModule {}
