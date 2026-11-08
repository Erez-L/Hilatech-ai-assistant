import { Inject, Injectable } from '@nestjs/common';
import { QueueName } from '@hilatech/contracts';
import { UnrecoverableError, type Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKERS_ENV } from '../../config/config.module';
import type { WorkersEnv } from '../../config/env.schema';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../../queue/job-processor';
import { EMAIL_DRIVER, type EmailDriver } from './email-driver';
import { collectSecretValues, EmailTemplateRenderError, renderEmail } from './email-templates';

/**
 * `email` queue: render the template and hand it to the configured driver.
 *
 * Idempotency: the producer uses `idempotencyKey` as the BullMQ `jobId`, so a duplicate enqueue while
 * a job with that id exists (waiting, active, completed within `removeOnComplete`, or failed within
 * `removeOnFail`) is collapsed by BullMQ and never reaches this processor. Delivery itself is
 * at-least-once: a retry after a transient SMTP failure may resend, which is acceptable for email.
 */
@Injectable()
export class EmailProcessor implements JobProcessor<typeof QueueName.EMAIL> {
  readonly queue = QueueName.EMAIL;

  constructor(
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    @Inject(EMAIL_DRIVER) private readonly driver: EmailDriver,
    @InjectPinoLogger(EmailProcessor.name) private readonly logger: PinoLogger,
  ) {}

  async process(job: Job<JobPayload<typeof QueueName.EMAIL>>, context: JobContext): Promise<JobOutcome> {
    const { to, template, variables, idempotencyKey, organizationId } = job.data;

    let rendered;
    try {
      rendered = renderEmail(template, variables, { appUrl: this.env.APP_URL });
    } catch (err) {
      if (err instanceof EmailTemplateRenderError) {
        this.logger.error({ ...context, template, issues: err.issues }, 'Email template variables are invalid; discarding job');
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }

    const result = await this.driver.send({
      ...rendered,
      to,
      from: this.env.EMAIL_FROM,
      template,
      idempotencyKey,
      organizationId,
      secrets: collectSecretValues(variables),
    });

    return { status: 'completed', template, driver: result.driver, messageId: result.messageId };
  }
}
