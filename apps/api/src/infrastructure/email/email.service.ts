import { type EmailJob, QueueName } from '@hilatech/contracts';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AppConfig } from '../../config/app-config.service';
import { QueueService } from '../queue/queue.service';

export type EmailTemplate = EmailJob['template'];

/**
 * Variables each template expects — the workers app validates them and fails the job permanently on a
 * mismatch. Links are built by the worker from `APP_URL`; the API passes raw tokens only.
 */
export interface EmailTemplateVariables {
  verify_email: { token: string; firstName?: string; expiresIn?: string; expiresInMs?: number };
  password_reset: {
    token: string;
    firstName?: string;
    expiresIn?: string;
    expiresInMs?: number;
  };
  invitation: {
    token: string;
    organizationName: string;
    inviterName?: string;
    roleName?: string;
    expiresIn?: string;
    expiresInMs?: number;
  };
  notification_digest: {
    notifications: Array<{ title: string; body?: string; link?: string }>;
    firstName?: string;
    organizationName?: string;
    periodLabel?: string;
  };
  generic: { subject: string; body: string; heading?: string; ctaLabel?: string; ctaUrl?: string };
}

/** Paths the worker uses when rendering links (mirrored here only for the development log driver). */
const DEV_LINK_PATHS: Partial<Record<EmailTemplate, string>> = {
  verify_email: '/verify-email?token=',
  password_reset: '/reset-password?token=',
  invitation: '/invite?token=',
};

export interface SendEmailOptions {
  /** Stable key so retries/duplicates collapse (becomes the BullMQ jobId). */
  idempotencyKey: string;
  organizationId?: string | null;
  requestId?: string | null;
  /** Recipient's language (a saved UI locale such as `he` or `he-IL`); anything else renders in English. */
  locale?: string | null;
}

/** Maps a stored UI locale to a language the email templates support. */
export function emailLocale(locale: string | null | undefined): 'en' | 'he' {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('he') ? 'he' : 'en';
}

/** The UI locale a user saved in their preferences, if any. */
export function savedLocaleOf(user: { preferences?: unknown } | null | undefined): string | null {
  const prefs = user?.preferences;
  if (prefs && typeof prefs === 'object' && 'locale' in prefs) {
    const value = (prefs as { locale?: unknown }).locale;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/**
 * Email producer. The API never talks to SMTP: it enqueues an `email` job that the workers app renders
 * and delivers through the configured driver. With `EMAIL_DRIVER=log` (development) the API also prints
 * the message content so links (verification, reset, invitation) are visible without running workers.
 */
@Injectable()
export class EmailService {
  private readonly driver: 'log' | 'smtp' | 'ses';
  private readonly appUrl: string;

  constructor(
    private readonly queue: QueueService,
    private readonly logger: Logger,
    config: AppConfig,
  ) {
    this.driver = config.get('EMAIL_DRIVER');
    this.appUrl = config.get('APP_URL');
    if (config.isProduction && this.driver === 'log') {
      this.logger.warn(
        'EMAIL_DRIVER=log in production: emails are only logged, not delivered',
        EmailService.name,
      );
    }
  }

  async send<T extends EmailTemplate>(
    template: T,
    to: string,
    variables: EmailTemplateVariables[T],
    options: SendEmailOptions,
  ): Promise<{ jobId: string }> {
    const payload = {
      organizationId: options.organizationId ?? null,
      idempotencyKey: options.idempotencyKey,
      requestId: options.requestId ?? undefined,
      enqueuedAt: new Date().toISOString(),
      to,
      template,
      variables: variables as Record<string, unknown>,
      locale: emailLocale(options.locale),
    } satisfies Omit<EmailJob, 'requestId'> & { requestId?: string };

    const result = await this.queue.enqueue(QueueName.EMAIL, payload);

    if (this.driver === 'log') {
      // Development driver: intentionally prints the full message content, including the action link the
      // worker would render, so verification / reset / invitation flows can be completed without workers.
      const path = DEV_LINK_PATHS[template];
      const token = (variables as { token?: string }).token;
      const devLink =
        path && token ? `${this.appUrl}${path}${encodeURIComponent(token)}` : undefined;
      this.logger.log(
        { email: { template, to, variables, devLink }, jobId: result.jobId, driver: 'log' },
        `[email:log] ${template} → ${to}${devLink ? ` ${devLink}` : ''}`,
        EmailService.name,
      );
    }
    return { jobId: result.jobId };
  }
}
