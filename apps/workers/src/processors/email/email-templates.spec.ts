import { buildLogPreview, type OutgoingEmail } from './email-driver';
import {
  collectSecretValues,
  EmailTemplateRenderError,
  escapeHtml,
  maskSecret,
  maskSecretsInText,
  renderEmail,
  resolveLink,
  TEMPLATE_VARIABLES,
  tokenLink,
  type EmailTemplate,
} from './email-templates';

const APP_URL = 'http://localhost:3000';
const TOKEN = 'Zx9kQ2mNp8RtVw4YbC7dFgH1jK3lM5nO6pQ8rS0tU2vW4xY6zA8b';

describe('email templates', () => {
  it('renders verify_email with a verification link built from APP_URL', () => {
    const out = renderEmail(
      'verify_email',
      { token: TOKEN, firstName: 'Dana' },
      { appUrl: APP_URL },
    );
    expect(out.subject).toContain('Verify your email');
    expect(out.text).toContain('Hi Dana,');
    expect(out.text).toContain(`${APP_URL}/verify-email?token=${TOKEN}`);
    expect(out.html).toContain(`href="${APP_URL}/verify-email?token=${TOKEN}"`);
    expect(out.html).toContain('<!doctype html>');
  });

  it('renders password_reset with a reset link and expiry', () => {
    const out = renderEmail(
      'password_reset',
      { token: TOKEN, expiresIn: '1 hour' },
      { appUrl: APP_URL },
    );
    expect(out.subject).toContain('Reset your');
    expect(out.text).toContain('Hello,');
    expect(out.text).toContain('expires in 1 hour');
    expect(out.text).toContain(`${APP_URL}/reset-password?token=${TOKEN}`);
    expect(out.html).toContain(`/reset-password?token=${TOKEN}`);
  });

  it('renders invitation with organization, inviter and role', () => {
    const out = renderEmail(
      'invitation',
      { token: TOKEN, organizationName: 'Acme & Sons', inviterName: 'Yael', roleName: 'admin' },
      { appUrl: APP_URL },
    );
    expect(out.subject).toBe("You're invited to join Acme & Sons on HilaTech AI Assistant");
    expect(out.text).toContain('Yael has invited you to join Acme & Sons as admin');
    expect(out.text).toContain(`${APP_URL}/invite?token=${TOKEN}`);
    // HTML-escaped organization name
    expect(out.html).toContain('Acme &amp; Sons');
    expect(out.html).not.toContain('Acme & Sons');
  });

  it('renders notification_digest with items and resolves relative links against APP_URL', () => {
    const out = renderEmail(
      'notification_digest',
      {
        firstName: 'Noa',
        organizationName: 'Demo',
        notifications: [
          { title: 'Lead assigned', body: 'Big deal', link: '/leads/123' },
          { title: 'Plain <b>item</b>' },
          { title: 'Bad link', link: 'javascript:alert(1)' },
        ],
      },
      { appUrl: APP_URL },
    );
    expect(out.subject).toBe('3 new notifications in Demo');
    expect(out.text).toContain('• Lead assigned');
    expect(out.text).toContain(`${APP_URL}/leads/123`);
    expect(out.html).toContain('Plain &lt;b&gt;item&lt;/b&gt;');
    expect(out.html).not.toContain('javascript:');
  });

  it('renders generic with paragraphs and an optional CTA', () => {
    const out = renderEmail(
      'generic',
      {
        subject: 'Weekly summary',
        body: 'First paragraph.\n\nSecond paragraph.',
        ctaLabel: 'Open dashboard',
        ctaUrl: '/dashboard',
      },
      { appUrl: APP_URL },
    );
    expect(out.subject).toBe('Weekly summary');
    expect(out.text).toContain(`Open dashboard: ${APP_URL}/dashboard`);
    expect(out.html.match(/<p style/g)?.length).toBeGreaterThanOrEqual(2);
    expect(out.html).toContain('Open dashboard');
  });

  it('rejects invalid variables with EmailTemplateRenderError (producer bug, not retryable)', () => {
    expect(() => renderEmail('verify_email', {}, { appUrl: APP_URL })).toThrow(
      EmailTemplateRenderError,
    );
    expect(() => renderEmail('invitation', { token: TOKEN }, { appUrl: APP_URL })).toThrow(
      /organizationName/,
    );
    expect(() =>
      renderEmail('notification_digest', { notifications: [] }, { appUrl: APP_URL }),
    ).toThrow(EmailTemplateRenderError);
  });

  it('has a variable schema for every template in the contract', () => {
    const templates: EmailTemplate[] = [
      'verify_email',
      'password_reset',
      'invitation',
      'notification_digest',
      'generic',
    ];
    for (const t of templates) expect(TEMPLATE_VARIABLES[t]).toBeDefined();
  });
});

describe('helpers', () => {
  it('escapeHtml escapes the five significant characters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
  });

  it('tokenLink URL-encodes the token', () => {
    expect(tokenLink(APP_URL, '/invite', 'a b+c')).toBe(`${APP_URL}/invite?token=a+b%2Bc`);
  });

  it('resolveLink only allows http(s)', () => {
    expect(resolveLink(APP_URL, '/x')).toBe(`${APP_URL}/x`);
    expect(resolveLink(APP_URL, 'https://example.com/y')).toBe('https://example.com/y');
    expect(resolveLink(APP_URL, 'javascript:alert(1)')).toBeUndefined();
    expect(resolveLink(APP_URL, undefined)).toBeUndefined();
  });

  it('maskSecret keeps only the first 6 characters', () => {
    expect(maskSecret(TOKEN)).toBe('Zx9kQ2…');
    expect(maskSecret('abc')).toBe('…');
  });

  it('collectSecretValues picks string values with secret-looking keys', () => {
    expect(
      collectSecretValues({ token: TOKEN, firstName: 'Dana', otpCode: '123456', n: 5 }),
    ).toEqual([TOKEN, '123456']);
  });

  it('maskSecretsInText masks known secrets and token= query params', () => {
    const text = `Visit ${APP_URL}/verify-email?token=${TOKEN} or https://x.test/a?code=SECRETCODE123&x=1`;
    const masked = maskSecretsInText(text, [TOKEN]);
    expect(masked).not.toContain(TOKEN);
    expect(masked).toContain('token=Zx9kQ2…');
    expect(masked).toContain('code=SECRET…&x=1');
  });
});

describe('log driver preview', () => {
  const outgoing = (
    template: EmailTemplate,
    variables: Record<string, unknown>,
  ): OutgoingEmail => ({
    ...renderEmail(template, variables, { appUrl: APP_URL }),
    to: 'user@example.com',
    from: 'HilaTech <no-reply@localhost>',
    template,
    idempotencyKey: 'email-verify-abc123',
    organizationId: null,
    secrets: collectSecretValues(variables),
  });

  it.each<[EmailTemplate, Record<string, unknown>]>([
    ['verify_email', { token: TOKEN, firstName: 'Dana' }],
    ['password_reset', { token: TOKEN }],
    ['invitation', { token: TOKEN, organizationName: 'Acme' }],
  ])('never includes the raw token for %s', (template, variables) => {
    const preview = buildLogPreview(outgoing(template, variables));
    const serialised = JSON.stringify(preview);
    expect(serialised).not.toContain(TOKEN);
    expect(preview.links.length).toBeGreaterThan(0);
    for (const link of preview.links) {
      expect(link).not.toContain(TOKEN);
      expect(link).toContain(`token=${TOKEN.slice(0, 6)}…`);
    }
    expect(preview.preview).toContain(`token=${TOKEN.slice(0, 6)}…`);
    expect(preview.to).toBe('user@example.com');
    expect(preview.subject.length).toBeGreaterThan(0);
  });

  it('truncates long previews', () => {
    const body = 'word '.repeat(500);
    const preview = buildLogPreview(outgoing('generic', { subject: 'S', body }));
    expect(preview.preview.length).toBeLessThanOrEqual(600);
  });
});

describe('renderEmail — Hebrew', () => {
  const options = { appUrl: 'https://app.example.com', locale: 'he' };

  it('renders the verification email right-to-left with Hebrew copy and a localized duration', () => {
    const email = renderEmail(
      'verify_email',
      { token: 'tok_1234567890abcdef', firstName: 'דנה', expiresInMs: 86_400_000 },
      options,
    );
    expect(email.subject).toBe('אימות כתובת האימייל שלכם ב-HilaTech AI Assistant');
    expect(email.html).toContain('<html lang="he" dir="rtl">');
    expect(email.html).toContain('שלום דנה,');
    expect(email.text).toContain('הקישור תקף למשך יום אחד.');
    expect(email.text).toContain('https://app.example.com/verify-email?token=tok_1234567890abcdef');
    expect(email.text).not.toMatch(/Please confirm|expires in/);
  });

  it('formats Hebrew durations (one, dual, plural) and falls back to the English text when only expiresIn is given', () => {
    const at = (expiresInMs: number) =>
      renderEmail('password_reset', { token: 'tok_1234567890abcdef', expiresInMs }, options).text;
    expect(at(3_600_000)).toContain('למשך שעה אחת.');
    expect(at(2 * 86_400_000)).toContain('למשך יומיים.');
    expect(at(7 * 86_400_000)).toContain('למשך 7 ימים.');
    const legacy = renderEmail(
      'password_reset',
      { token: 'tok_1234567890abcdef', expiresIn: '1 hour' },
      options,
    ).text;
    expect(legacy).toContain('למשך 1 hour.');
  });

  it('renders the invitation in Hebrew and escapes the supplied names', () => {
    const email = renderEmail(
      'invitation',
      {
        token: 'tok_1234567890abcdef',
        organizationName: 'אקמה <b>בע"מ</b>',
        inviterName: 'נועה לוי',
        roleName: 'מנהל',
        expiresInMs: 7 * 86_400_000,
      },
      options,
    );
    expect(email.subject).toContain('הוזמנתם להצטרף אל');
    expect(email.text).toContain('נועה לוי הזמין/ה אתכם להצטרף אל');
    expect(email.text).toContain('בתפקיד מנהל');
    expect(email.html).toContain('&lt;b&gt;');
    expect(email.html).not.toContain('<b>בע');
  });

  it('unknown locales render in English (left-to-right)', () => {
    const email = renderEmail(
      'verify_email',
      { token: 'tok_1234567890abcdef', expiresInMs: 3_600_000 },
      { appUrl: 'https://app.example.com', locale: 'fr' },
    );
    expect(email.html).toContain('<html lang="en" dir="ltr">');
    expect(email.text).toContain('The link expires in 1 hour.');
  });
});
