import type { EmailJob } from '@hilatech/contracts';
import { z, type ZodIssue, type ZodTypeAny } from 'zod';

export type EmailTemplate = EmailJob['template'];

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface RenderOptions {
  /** Public web app origin used to build links (`/verify-email?token=`, `/reset-password?token=`, `/invite?token=`). */
  appUrl: string;
  productName?: string;
}

// ---------------------------------------------------------------------------
// Per-template variable contracts. The queue contract types `variables` as a plain record; these
// schemas say what each template actually needs so a producer mistake is rejected (no retries)
// instead of sending a half-rendered email.
// ---------------------------------------------------------------------------

const tokenVars = z.object({
  token: z.string().min(1),
  firstName: z.string().max(80).optional(),
  expiresIn: z.string().max(40).optional(),
});

export const TEMPLATE_VARIABLES = {
  verify_email: tokenVars,
  password_reset: tokenVars,
  invitation: z.object({
    token: z.string().min(1),
    organizationName: z.string().min(1).max(100),
    inviterName: z.string().max(160).optional(),
    roleName: z.string().max(60).optional(),
    expiresIn: z.string().max(40).optional(),
  }),
  notification_digest: z.object({
    firstName: z.string().max(80).optional(),
    organizationName: z.string().max(100).optional(),
    periodLabel: z.string().max(60).optional(),
    notifications: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          body: z.string().max(2000).optional(),
          link: z.string().max(2000).optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
  generic: z.object({
    subject: z.string().min(1).max(200),
    heading: z.string().max(200).optional(),
    body: z.string().min(1).max(10_000),
    ctaLabel: z.string().max(60).optional(),
    ctaUrl: z.string().max(2000).optional(),
  }),
} as const satisfies Record<EmailTemplate, ZodTypeAny>;

export type TemplateVariables<T extends EmailTemplate> = z.infer<(typeof TEMPLATE_VARIABLES)[T]>;

export class EmailTemplateRenderError extends Error {
  constructor(
    readonly template: EmailTemplate,
    readonly issues: ZodIssue[],
  ) {
    super(`Invalid variables for email template "${template}": ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    this.name = 'EmailTemplateRenderError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Build an absolute app link with a token in the query string. */
export function tokenLink(appUrl: string, path: string, token: string): string {
  const url = new URL(path, appUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Resolve a (possibly relative) link against the app URL; only http(s) results are allowed. */
export function resolveLink(appUrl: string, link: string | undefined): string | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link, appUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function greeting(firstName: string | undefined): string {
  return firstName ? `Hi ${firstName},` : 'Hello,';
}

// ---------------------------------------------------------------------------
// HTML layout (inline styles only — email clients ignore <style> blocks)
// ---------------------------------------------------------------------------

interface LayoutInput {
  productName: string;
  heading: string;
  /** Already-escaped HTML fragments, one per paragraph/block. */
  blocks: string[];
  cta?: { label: string; url: string };
  footer: string;
}

function layout({ productName, heading, blocks, cta, footer }: LayoutInput): string {
  const body = blocks.join('\n');
  const button = cta
    ? `<tr><td style="padding:8px 32px 24px">
  <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${escapeHtml(cta.label)}</a>
  <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:#6b7280">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;color:#0f766e">${escapeHtml(cta.url)}</span></p>
</td></tr>`
    : '';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
<tr><td style="padding:28px 32px 4px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f766e">${escapeHtml(productName)}</td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:#0b1220">${escapeHtml(heading)}</h1>
${body}
</td></tr>
${button}
<tr><td style="padding:0 32px 28px;font-size:12px;line-height:18px;color:#6b7280;border-top:1px solid #f1f5f9;padding-top:16px">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const p = (text: string): string => `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#374151">${escapeHtml(text)}</p>`;

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderEmail(template: EmailTemplate, variables: Record<string, unknown>, options: RenderOptions): RenderedEmail {
  const productName = options.productName ?? 'HilaTech AI Assistant';
  const schema = TEMPLATE_VARIABLES[template];
  const parsed = schema.safeParse(variables);
  if (!parsed.success) throw new EmailTemplateRenderError(template, parsed.error.issues);

  switch (template) {
    case 'verify_email': {
      const v = parsed.data as TemplateVariables<'verify_email'>;
      const link = tokenLink(options.appUrl, '/verify-email', v.token);
      const expiry = v.expiresIn ? ` The link expires in ${v.expiresIn}.` : '';
      const subject = `Verify your email for ${productName}`;
      const text = [
        greeting(v.firstName),
        '',
        `Please confirm your email address to finish setting up your ${productName} account.${expiry}`,
        '',
        link,
        '',
        'If you did not create an account, you can ignore this message.',
      ].join('\n');
      const html = layout({
        productName,
        heading: 'Confirm your email address',
        blocks: [p(greeting(v.firstName)), p(`Please confirm your email address to finish setting up your ${productName} account.${expiry}`)],
        cta: { label: 'Verify email', url: link },
        footer: 'If you did not create an account, you can safely ignore this email.',
      });
      return { subject, text, html };
    }

    case 'password_reset': {
      const v = parsed.data as TemplateVariables<'password_reset'>;
      const link = tokenLink(options.appUrl, '/reset-password', v.token);
      const expiry = v.expiresIn ? ` This link expires in ${v.expiresIn}.` : '';
      const subject = `Reset your ${productName} password`;
      const text = [
        greeting(v.firstName),
        '',
        `We received a request to reset the password for your account.${expiry}`,
        '',
        link,
        '',
        'If you did not request a password reset, no action is needed — your password stays unchanged.',
      ].join('\n');
      const html = layout({
        productName,
        heading: 'Reset your password',
        blocks: [p(greeting(v.firstName)), p(`We received a request to reset the password for your account.${expiry}`)],
        cta: { label: 'Choose a new password', url: link },
        footer: 'If you did not request a password reset, no action is needed — your password stays unchanged.',
      });
      return { subject, text, html };
    }

    case 'invitation': {
      const v = parsed.data as TemplateVariables<'invitation'>;
      const link = tokenLink(options.appUrl, '/invite', v.token);
      const who = v.inviterName ? `${v.inviterName} has invited you` : 'You have been invited';
      const role = v.roleName ? ` as ${v.roleName}` : '';
      const expiry = v.expiresIn ? ` The invitation expires in ${v.expiresIn}.` : '';
      const subject = `You're invited to join ${v.organizationName} on ${productName}`;
      const intro = `${who} to join ${v.organizationName}${role} on ${productName}.${expiry}`;
      const text = ['Hello,', '', intro, '', 'Accept the invitation:', link, '', 'If you were not expecting this invitation, you can ignore this email.'].join('\n');
      const html = layout({
        productName,
        heading: `Join ${v.organizationName}`,
        blocks: [p('Hello,'), p(intro)],
        cta: { label: 'Accept invitation', url: link },
        footer: 'If you were not expecting this invitation, you can ignore this email.',
      });
      return { subject, text, html };
    }

    case 'notification_digest': {
      const v = parsed.data as TemplateVariables<'notification_digest'>;
      const count = v.notifications.length;
      const scope = v.organizationName ? ` in ${v.organizationName}` : '';
      const period = v.periodLabel ? ` (${v.periodLabel})` : '';
      const subject = `${count} new notification${count === 1 ? '' : 's'}${scope}${period}`;
      const items = v.notifications.map((n) => ({ ...n, url: resolveLink(options.appUrl, n.link) }));
      const textItems = items.map((n) => [`• ${n.title}`, n.body ? `  ${n.body}` : null, n.url ? `  ${n.url}` : null].filter(Boolean).join('\n'));
      const text = [greeting(v.firstName), '', `Here is what happened${scope}${period}:`, '', ...textItems, '', `Open ${productName}: ${options.appUrl}`].join('\n');
      const htmlItems = items
        .map(
          (n) => `<tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
  <div style="font-size:15px;font-weight:600;color:#0b1220">${n.url ? `<a href="${escapeHtml(n.url)}" style="color:#0f766e;text-decoration:none">${escapeHtml(n.title)}</a>` : escapeHtml(n.title)}</div>
  ${n.body ? `<div style="font-size:14px;line-height:20px;color:#4b5563;margin-top:2px">${escapeHtml(n.body)}</div>` : ''}
</td></tr>`,
        )
        .join('\n');
      const html = layout({
        productName,
        heading: subject,
        blocks: [p(greeting(v.firstName)), p(`Here is what happened${scope}${period}:`), `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px">${htmlItems}</table>`],
        cta: { label: `Open ${productName}`, url: options.appUrl },
        footer: 'You receive this digest because email notifications are enabled in your preferences.',
      });
      return { subject, text, html };
    }

    case 'generic': {
      const v = parsed.data as TemplateVariables<'generic'>;
      const ctaUrl = resolveLink(options.appUrl, v.ctaUrl);
      const cta = ctaUrl && v.ctaLabel ? { label: v.ctaLabel, url: ctaUrl } : undefined;
      const paragraphs = v.body.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      const text = [v.heading ?? v.subject, '', v.body, ...(cta ? ['', `${cta.label}: ${cta.url}`] : [])].join('\n');
      const html = layout({
        productName,
        heading: v.heading ?? v.subject,
        blocks: paragraphs.map((para) => p(para)),
        cta,
        footer: `Sent by ${escapeHtml(productName)}.`,
      });
      return { subject: v.subject, text, html };
    }

    default: {
      const exhaustive: never = template;
      throw new Error(`Unknown email template: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Secret masking (used by the log driver so raw tokens never reach stdout)
// ---------------------------------------------------------------------------

const SECRET_KEY = /(token|secret|password|otp|code)/i;
const SECRET_QUERY_PARAM = /([?&](?:token|code|key|secret)=)([^&\s"'<>]+)/gi;

/** Keep the first 6 characters, replace the rest. */
export function maskSecret(value: string): string {
  if (value.length <= 6) return '…';
  return `${value.slice(0, 6)}…`;
}

/** String values of variables whose key looks like a secret (`token`, `code`, ...). */
export function collectSecretValues(variables: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    if (SECRET_KEY.test(key) && typeof value === 'string' && value.length >= 4) out.push(value);
  }
  return out;
}

/** Replace known secret values and any `token=`-style query parameter with a masked form. */
export function maskSecretsInText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(maskSecret(secret));
  out = out.replace(SECRET_QUERY_PARAM, (_m, prefix: string, value: string) => `${prefix}${maskSecret(value)}`);
  return out;
}

/** Extract http(s) links from a text body. */
export function extractLinks(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"')\]]+/g), (m) => m[0]);
}
