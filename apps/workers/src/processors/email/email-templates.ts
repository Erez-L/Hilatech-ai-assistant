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
  /** Language of the fixed copy; English unless `he`. */
  locale?: string;
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
  /** Preferred over `expiresIn`: formatted by the worker in the email's language. */
  expiresInMs: z.number().int().positive().optional(),
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
    expiresInMs: z.number().int().positive().optional(),
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
    super(
      `Invalid variables for email template "${template}": ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
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

// ---------------------------------------------------------------------------
// Copy (English and Hebrew). Variables supplied by callers (names, organization, notification
// titles/bodies) are inserted as they are; only the fixed copy is translated.
// ---------------------------------------------------------------------------

export type EmailLocale = 'en' | 'he';

interface Copy {
  dir: 'ltr' | 'rtl';
  greeting(firstName: string | undefined): string;
  hello: string;
  linkFallback: string;
  duration(ms: number): string;
  verify: {
    subject(product: string): string;
    heading: string;
    body(product: string): string;
    expiry(duration: string): string;
    cta: string;
    ignore: string;
  };
  reset: {
    subject(product: string): string;
    heading: string;
    body: string;
    expiry(duration: string): string;
    cta: string;
    ignore: string;
  };
  invitation: {
    subject(organization: string, product: string): string;
    heading(organization: string): string;
    intro(input: {
      inviterName?: string;
      organization: string;
      roleName?: string;
      product: string;
    }): string;
    expiry(duration: string): string;
    acceptLine: string;
    cta: string;
    ignore: string;
  };
  digest: {
    subject(count: number, organization: string | undefined, period: string | undefined): string;
    intro(organization: string | undefined, period: string | undefined): string;
    open(product: string): string;
    footer: string;
  };
  generic: { footer(product: string): string };
}

const UNITS: Array<[number, 'day' | 'hour' | 'minute']> = [
  [86_400_000, 'day'],
  [3_600_000, 'hour'],
  [60_000, 'minute'],
];

function splitDuration(ms: number): { n: number; unit: 'day' | 'hour' | 'minute' } {
  for (const [size, unit] of UNITS) {
    if (ms >= size && ms % size === 0) return { n: ms / size, unit };
  }
  return { n: Math.max(1, Math.round(ms / 60_000)), unit: 'minute' };
}

const HE_UNITS = {
  day: { one: 'יום אחד', two: 'יומיים', many: 'ימים' },
  hour: { one: 'שעה אחת', two: 'שעתיים', many: 'שעות' },
  minute: { one: 'דקה אחת', two: 'שתי דקות', many: 'דקות' },
} as const;

const COPY: Record<EmailLocale, Copy> = {
  en: {
    dir: 'ltr',
    greeting: (firstName) => (firstName ? `Hi ${firstName},` : 'Hello,'),
    hello: 'Hello,',
    linkFallback: 'If the button does not work, copy this link into your browser:',
    duration: (ms) => {
      const { n, unit } = splitDuration(ms);
      return `${n} ${unit}${n === 1 ? '' : 's'}`;
    },
    verify: {
      subject: (product) => `Verify your email for ${product}`,
      heading: 'Confirm your email address',
      body: (product) =>
        `Please confirm your email address to finish setting up your ${product} account.`,
      expiry: (duration) => ` The link expires in ${duration}.`,
      cta: 'Verify email',
      ignore: 'If you did not create an account, you can safely ignore this email.',
    },
    reset: {
      subject: (product) => `Reset your ${product} password`,
      heading: 'Reset your password',
      body: 'We received a request to reset the password for your account.',
      expiry: (duration) => ` This link expires in ${duration}.`,
      cta: 'Choose a new password',
      ignore:
        'If you did not request a password reset, no action is needed — your password stays unchanged.',
    },
    invitation: {
      subject: (organization, product) => `You're invited to join ${organization} on ${product}`,
      heading: (organization) => `Join ${organization}`,
      intro: ({ inviterName, organization, roleName, product }) =>
        `${inviterName ? `${inviterName} has invited you` : 'You have been invited'} to join ${organization}${roleName ? ` as ${roleName}` : ''} on ${product}.`,
      expiry: (duration) => ` The invitation expires in ${duration}.`,
      acceptLine: 'Accept the invitation:',
      cta: 'Accept invitation',
      ignore: 'If you were not expecting this invitation, you can ignore this email.',
    },
    digest: {
      subject: (count, organization, period) =>
        `${count} new notification${count === 1 ? '' : 's'}${organization ? ` in ${organization}` : ''}${period ? ` (${period})` : ''}`,
      intro: (organization, period) =>
        `Here is what happened${organization ? ` in ${organization}` : ''}${period ? ` (${period})` : ''}:`,
      open: (product) => `Open ${product}`,
      footer:
        'You receive this digest because email notifications are enabled in your preferences.',
    },
    generic: { footer: (product) => `Sent by ${product}.` },
  },
  he: {
    dir: 'rtl',
    greeting: (firstName) => (firstName ? `שלום ${firstName},` : 'שלום,'),
    hello: 'שלום,',
    linkFallback: 'אם הכפתור אינו פועל, העתיקו את הקישור הבא לדפדפן:',
    duration: (ms) => {
      const { n, unit } = splitDuration(ms);
      const words = HE_UNITS[unit];
      return n === 1 ? words.one : n === 2 ? words.two : `${n} ${words.many}`;
    },
    verify: {
      subject: (product) => `אימות כתובת האימייל שלכם ב-${product}`,
      heading: 'אמתו את כתובת האימייל',
      body: (product) => `אנא אמתו את כתובת האימייל כדי להשלים את הגדרת החשבון שלכם ב-${product}.`,
      expiry: (duration) => ` הקישור תקף למשך ${duration}.`,
      cta: 'אימות האימייל',
      ignore: 'אם לא יצרתם חשבון, אפשר להתעלם מהודעה זו.',
    },
    reset: {
      subject: (product) => `איפוס הסיסמה שלכם ב-${product}`,
      heading: 'איפוס סיסמה',
      body: 'קיבלנו בקשה לאפס את הסיסמה של החשבון שלכם.',
      expiry: (duration) => ` הקישור תקף למשך ${duration}.`,
      cta: 'בחירת סיסמה חדשה',
      ignore: 'אם לא ביקשתם לאפס את הסיסמה, אין צורך לעשות דבר — הסיסמה נשארת ללא שינוי.',
    },
    invitation: {
      subject: (organization, product) => `הוזמנתם להצטרף אל ${organization} ב-${product}`,
      heading: (organization) => `הצטרפות אל ${organization}`,
      intro: ({ inviterName, organization, roleName, product }) =>
        `${inviterName ? `${inviterName} הזמין/ה אתכם` : 'הוזמנתם'} להצטרף אל ${organization}${roleName ? ` בתפקיד ${roleName}` : ''} ב-${product}.`,
      expiry: (duration) => ` ההזמנה תקפה למשך ${duration}.`,
      acceptLine: 'אישור ההזמנה:',
      cta: 'אישור ההזמנה',
      ignore: 'אם לא ציפיתם להזמנה הזו, אפשר להתעלם מהודעה זו.',
    },
    digest: {
      subject: (count, organization, period) =>
        `${count === 1 ? 'התראה חדשה אחת' : `${count} התראות חדשות`}${organization ? ` ב-${organization}` : ''}${period ? ` (${period})` : ''}`,
      intro: (organization, period) =>
        `זה מה שקרה${organization ? ` ב-${organization}` : ''}${period ? ` (${period})` : ''}:`,
      open: (product) => `פתיחת ${product}`,
      footer: 'אתם מקבלים סיכום זה משום שהתראות באימייל מופעלות בהעדפות שלכם.',
    },
    generic: { footer: (product) => `נשלח על ידי ${product}.` },
  },
};

/** The expiry text: the worker formats `expiresInMs` in the email's language; `expiresIn` is the English fallback. */
function expiryText(
  copy: Copy,
  v: { expiresIn?: string; expiresInMs?: number },
): string | undefined {
  if (typeof v.expiresInMs === 'number' && v.expiresInMs > 0) return copy.duration(v.expiresInMs);
  return v.expiresIn;
}

// ---------------------------------------------------------------------------
// HTML layout (inline styles only — email clients ignore <style> blocks)
// ---------------------------------------------------------------------------

interface LayoutInput {
  locale: EmailLocale;
  productName: string;
  heading: string;
  /** Already-escaped HTML fragments, one per paragraph/block. */
  blocks: string[];
  cta?: { label: string; url: string };
  footer: string;
}

function layout({ locale, productName, heading, blocks, cta, footer }: LayoutInput): string {
  const copy = COPY[locale];
  const align = copy.dir === 'rtl' ? 'right' : 'left';
  const body = blocks.join('\n');
  const button = cta
    ? `<tr><td style="padding:8px 32px 24px;text-align:${align}">
  <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${escapeHtml(cta.label)}</a>
  <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:#6b7280">${escapeHtml(copy.linkFallback)}<br><span dir="ltr" style="word-break:break-all;color:#0f766e">${escapeHtml(cta.url)}</span></p>
</td></tr>`
    : '';

  return `<!doctype html>
<html lang="${locale}" dir="${copy.dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" dir="${copy.dir}" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7;padding:32px 16px">
<tr><td align="center">
<table role="presentation" dir="${copy.dir}" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;text-align:${align}">
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

const p = (text: string): string =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#374151">${escapeHtml(text)}</p>`;

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderEmail(
  template: EmailTemplate,
  variables: Record<string, unknown>,
  options: RenderOptions,
): RenderedEmail {
  const productName = options.productName ?? 'HilaTech AI Assistant';
  const locale: EmailLocale = options.locale === 'he' ? 'he' : 'en';
  const copy = COPY[locale];
  const schema = TEMPLATE_VARIABLES[template];
  const parsed = schema.safeParse(variables);
  if (!parsed.success) throw new EmailTemplateRenderError(template, parsed.error.issues);

  switch (template) {
    case 'verify_email': {
      const v = parsed.data as TemplateVariables<'verify_email'>;
      const link = tokenLink(options.appUrl, '/verify-email', v.token);
      const duration = expiryText(copy, v);
      const body = `${copy.verify.body(productName)}${duration ? copy.verify.expiry(duration) : ''}`;
      const subject = copy.verify.subject(productName);
      const text = [copy.greeting(v.firstName), '', body, '', link, '', copy.verify.ignore].join(
        '\n',
      );
      const html = layout({
        locale,
        productName,
        heading: copy.verify.heading,
        blocks: [p(copy.greeting(v.firstName)), p(body)],
        cta: { label: copy.verify.cta, url: link },
        footer: escapeHtml(copy.verify.ignore),
      });
      return { subject, text, html };
    }

    case 'password_reset': {
      const v = parsed.data as TemplateVariables<'password_reset'>;
      const link = tokenLink(options.appUrl, '/reset-password', v.token);
      const duration = expiryText(copy, v);
      const body = `${copy.reset.body}${duration ? copy.reset.expiry(duration) : ''}`;
      const subject = copy.reset.subject(productName);
      const text = [copy.greeting(v.firstName), '', body, '', link, '', copy.reset.ignore].join(
        '\n',
      );
      const html = layout({
        locale,
        productName,
        heading: copy.reset.heading,
        blocks: [p(copy.greeting(v.firstName)), p(body)],
        cta: { label: copy.reset.cta, url: link },
        footer: escapeHtml(copy.reset.ignore),
      });
      return { subject, text, html };
    }

    case 'invitation': {
      const v = parsed.data as TemplateVariables<'invitation'>;
      const link = tokenLink(options.appUrl, '/invite', v.token);
      const duration = expiryText(copy, v);
      const subject = copy.invitation.subject(v.organizationName, productName);
      const intro = `${copy.invitation.intro({
        inviterName: v.inviterName,
        organization: v.organizationName,
        roleName: v.roleName,
        product: productName,
      })}${duration ? copy.invitation.expiry(duration) : ''}`;
      const text = [
        copy.hello,
        '',
        intro,
        '',
        copy.invitation.acceptLine,
        link,
        '',
        copy.invitation.ignore,
      ].join('\n');
      const html = layout({
        locale,
        productName,
        heading: copy.invitation.heading(v.organizationName),
        blocks: [p(copy.hello), p(intro)],
        cta: { label: copy.invitation.cta, url: link },
        footer: escapeHtml(copy.invitation.ignore),
      });
      return { subject, text, html };
    }

    case 'notification_digest': {
      const v = parsed.data as TemplateVariables<'notification_digest'>;
      const subject = copy.digest.subject(
        v.notifications.length,
        v.organizationName,
        v.periodLabel,
      );
      const intro = copy.digest.intro(v.organizationName, v.periodLabel);
      const items = v.notifications.map((n) => ({
        ...n,
        url: resolveLink(options.appUrl, n.link),
      }));
      const textItems = items.map((n) =>
        [`• ${n.title}`, n.body ? `  ${n.body}` : null, n.url ? `  ${n.url}` : null]
          .filter(Boolean)
          .join('\n'),
      );
      const text = [
        copy.greeting(v.firstName),
        '',
        intro,
        '',
        ...textItems,
        '',
        `${copy.digest.open(productName)}: ${options.appUrl}`,
      ].join('\n');
      const htmlItems = items
        .map(
          (n) => `<tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
  <div style="font-size:15px;font-weight:600;color:#0b1220">${n.url ? `<a href="${escapeHtml(n.url)}" style="color:#0f766e;text-decoration:none">${escapeHtml(n.title)}</a>` : escapeHtml(n.title)}</div>
  ${n.body ? `<div style="font-size:14px;line-height:20px;color:#4b5563;margin-top:2px">${escapeHtml(n.body)}</div>` : ''}
</td></tr>`,
        )
        .join('\n');
      const html = layout({
        locale,
        productName,
        heading: subject,
        blocks: [
          p(copy.greeting(v.firstName)),
          p(intro),
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px">${htmlItems}</table>`,
        ],
        cta: { label: copy.digest.open(productName), url: options.appUrl },
        footer: escapeHtml(copy.digest.footer),
      });
      return { subject, text, html };
    }

    case 'generic': {
      const v = parsed.data as TemplateVariables<'generic'>;
      const ctaUrl = resolveLink(options.appUrl, v.ctaUrl);
      const cta = ctaUrl && v.ctaLabel ? { label: v.ctaLabel, url: ctaUrl } : undefined;
      const paragraphs = v.body
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean);
      const text = [
        v.heading ?? v.subject,
        '',
        v.body,
        ...(cta ? ['', `${cta.label}: ${cta.url}`] : []),
      ].join('\n');
      const html = layout({
        locale,
        productName,
        heading: v.heading ?? v.subject,
        blocks: paragraphs.map((para) => p(para)),
        cta,
        footer: escapeHtml(copy.generic.footer(productName)),
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
  out = out.replace(
    SECRET_QUERY_PARAM,
    (_m, prefix: string, value: string) => `${prefix}${maskSecret(value)}`,
  );
  return out;
}

/** Extract http(s) links from a text body. */
export function extractLinks(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"')\]]+/g), (m) => m[0]);
}
