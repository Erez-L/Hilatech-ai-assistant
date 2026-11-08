import { Inject, Injectable } from '@nestjs/common';
import { truncate } from '@hilatech/shared';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTransport, type Transporter } from 'nodemailer';
import { WORKERS_ENV } from '../../config/config.module';
import type { WorkersEnv } from '../../config/env.schema';
import { extractLinks, maskSecretsInText, type EmailTemplate, type RenderedEmail } from './email-templates';

export interface OutgoingEmail extends RenderedEmail {
  to: string;
  from: string;
  template: EmailTemplate;
  idempotencyKey: string;
  organizationId: string | null;
  /** Secret values (tokens…) that must never appear in logs. */
  secrets: readonly string[];
}

export interface EmailDeliveryResult {
  driver: 'log' | 'smtp';
  messageId: string | null;
}

export interface EmailDriver {
  readonly name: 'log' | 'smtp';
  send(email: OutgoingEmail): Promise<EmailDeliveryResult>;
}

/** Injection token for the active `EmailDriver` (chosen from `EMAIL_DRIVER`). */
export const EMAIL_DRIVER = Symbol('EMAIL_DRIVER');

/** Payload the log driver writes — exported so tests can assert nothing secret leaks. */
export interface LoggedEmailPreview {
  driver: 'log';
  to: string;
  from: string;
  template: EmailTemplate;
  subject: string;
  idempotencyKey: string;
  organizationId: string | null;
  /** Links from the text body with tokens masked (first 6 chars kept). */
  links: string[];
  /** Start of the text body with secrets masked. */
  preview: string;
}

export function buildLogPreview(email: OutgoingEmail, previewChars = 600): LoggedEmailPreview {
  const maskedText = maskSecretsInText(email.text, email.secrets);
  return {
    driver: 'log',
    to: email.to,
    from: email.from,
    template: email.template,
    subject: maskSecretsInText(email.subject, email.secrets),
    idempotencyKey: email.idempotencyKey,
    organizationId: email.organizationId,
    links: extractLinks(maskedText),
    preview: truncate(maskedText.replace(/\s*\n\s*/g, ' ⏎ '), previewChars),
  };
}

/**
 * Development driver (`EMAIL_DRIVER=log`): nothing is delivered; a redacted preview is logged at
 * info level. Raw token values never reach the log — links keep only the first 6 token characters.
 */
@Injectable()
export class LogEmailDriver implements EmailDriver {
  readonly name = 'log' as const;

  constructor(@InjectPinoLogger(LogEmailDriver.name) private readonly logger: PinoLogger) {}

  async send(email: OutgoingEmail): Promise<EmailDeliveryResult> {
    this.logger.info({ email: buildLogPreview(email) }, 'Email rendered (log driver — not delivered)');
    return { driver: 'log', messageId: null };
  }
}

/** Production driver (`EMAIL_DRIVER=smtp`): nodemailer transport built lazily from `SMTP_*`. */
@Injectable()
export class SmtpEmailDriver implements EmailDriver {
  readonly name = 'smtp' as const;
  private transport?: Transporter;

  constructor(
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    @InjectPinoLogger(SmtpEmailDriver.name) private readonly logger: PinoLogger,
  ) {}

  private getTransport(): Transporter {
    if (!this.transport) {
      if (!this.env.SMTP_HOST) throw new Error('SMTP_HOST is not configured');
      this.transport = createTransport({
        host: this.env.SMTP_HOST,
        port: this.env.SMTP_PORT,
        secure: this.env.SMTP_SECURE,
        auth: this.env.SMTP_USER && this.env.SMTP_PASSWORD ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      });
    }
    return this.transport;
  }

  async send(email: OutgoingEmail): Promise<EmailDeliveryResult> {
    const info = await this.getTransport().sendMail({
      from: email.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: { 'X-HTA-Idempotency-Key': email.idempotencyKey },
    });
    const messageId: string | null = typeof info.messageId === 'string' ? info.messageId : null;
    this.logger.info(
      { to: email.to, template: email.template, idempotencyKey: email.idempotencyKey, messageId, accepted: info.accepted?.length ?? 0, rejected: info.rejected?.length ?? 0 },
      'Email sent via SMTP',
    );
    return { driver: 'smtp', messageId };
  }
}
