import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/messages/en';
import { he } from '../src/i18n/messages/he';

/**
 * Hebrew / RTL journey: pick Hebrew with the switcher on the register page, register, create an organization,
 * check <html dir lang> and key pages, persist across reload, then switch back to English.
 * Expected texts come from the dictionaries so the spec follows copy edits.
 */
const BASE_URL = process.env.E2E_BASE_URL;

type Key = keyof typeof en;
const H = (k: Key) => String(he[k]);
const E = (k: Key) => String(en[k]);
const html = (page: Page) => page.locator('html');

test.describe('hebrew / rtl journey', () => {
  test.skip(!BASE_URL, 'Set E2E_BASE_URL to run end-to-end tests against a running stack');

  const stamp = Date.now();
  const email = `e2e-he-${stamp}@example.test`;
  const password = 'E2e-Passw0rd-Strong';

  test('defaults to English LTR, switches to Hebrew RTL, persists, and switches back', async ({
    page,
  }) => {
    await page.goto('/register');
    await expect(html(page)).toHaveAttribute('lang', 'en');
    await expect(html(page)).toHaveAttribute('dir', 'ltr');

    // Switch on the register page.
    await page.getByRole('button', { name: E('shell.language') }).click();
    await page.getByRole('menuitemradio', { name: H('common.hebrew') }).click();
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: H('common.createAccount') })).toBeVisible();

    // Register in Hebrew.
    await page.getByLabel(H('common.firstName')).fill('ארז');
    await page.getByLabel(H('common.lastName')).fill('בודק');
    await page.getByLabel(H('auth.workEmail')).fill(email);
    await page.getByLabel(new RegExp(`^${H('common.password')}`)).fill(password);
    await page.getByRole('button', { name: H('common.createAccount') }).click();

    await expect(page).toHaveURL(/\/onboarding/);
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await page.getByLabel(H('onboarding.organizationName')).fill(`ארגון בדיקה ${stamp}`);
    await page.getByRole('button', { name: H('common.createOrganization') }).click();

    // Dashboard in Hebrew.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      new RegExp(
        [
          H('dashboard.greetingMorning'),
          H('dashboard.greetingAfternoon'),
          H('dashboard.greetingEvening'),
        ]
          .map((s) =>
            String(s)
              .replace(/\{.*?\}/g, '')
              .trim(),
          )
          .join('|'),
      ),
    );
    // No English product copy leaked into the shell.
    await expect(page.getByRole('link', { name: H('shell.team') }).first()).toBeVisible();
    await expect(page.getByRole('navigation').getByText('Conversations')).toHaveCount(0);

    // Key pages render Hebrew headings and stay RTL.
    await page
      .getByRole('link', { name: H('shell.team') })
      .first()
      .click();
    await expect(page).toHaveURL(/\/team/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(H('shell.team'));
    await expect(page.getByText(H('team.members')).first()).toBeVisible();
    await page.goto('/settings/profile');
    await expect(page.getByText(H('settings.yourProfile')).first()).toBeVisible();
    await expect(html(page)).toHaveAttribute('dir', 'rtl');

    // The choice is persisted to the profile: it survives a reload and a cleared cookie.
    await page.reload();
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await page.context().clearCookies({ name: 'hta_locale' });
    await page.reload();
    await expect(html(page)).toHaveAttribute('lang', 'he');

    // Switch back to English from the user menu.
    await page.getByRole('button', { name: /^תפריט החשבון/ }).click();
    await page.getByRole('menuitemradio', { name: E('common.english') }).click();
    await expect(html(page)).toHaveAttribute('lang', 'en');
    await expect(html(page)).toHaveAttribute('dir', 'ltr');
    await expect(page.getByText(E('settings.yourProfile')).first()).toBeVisible();
  });

  test('Accept-Language selects Hebrew when nothing is saved', async ({ browser }) => {
    const context = await browser.newContext({
      locale: 'he-IL',
      extraHTTPHeaders: { 'Accept-Language': 'he-IL,he;q=0.9' },
    });
    const page = await context.newPage();
    await page.goto('/login');
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await context.close();
  });
});
