import { expect, test, type Page } from '@playwright/test';

/**
 * Critical journey: register → onboarding (create organization) → dashboard → invite a teammate.
 * Requires the full stack (web + api + postgres + redis). Enabled only when E2E_BASE_URL is set.
 */
const BASE_URL = process.env.E2E_BASE_URL;

test.describe('critical journey', () => {
  test.skip(!BASE_URL, 'Set E2E_BASE_URL to run end-to-end tests against a running stack');

  const stamp = Date.now();
  const email = `e2e-${stamp}@example.test`;
  const password = 'E2e-Passw0rd-Strong';
  const orgName = `E2E Org ${stamp}`;

  test('register, create an organization, reach the dashboard and invite a teammate', async ({
    page,
  }) => {
    await page.goto('/register');
    await page.getByLabel('First name').fill('Erez');
    await page.getByLabel('Last name').fill('Tester');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    // New accounts have no organization → onboarding.
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel('Organization name').fill(orgName);
    await page.getByRole('button', { name: 'Create organization' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /Good (morning|afternoon|evening)/,
    );
    await expect(
      page.getByRole('button', { name: new RegExp(`Organization: ${orgName}`) }),
    ).toBeVisible();
    await expect(page.getByText('Team members')).toBeVisible();

    // Invite a teammate from the team page.
    await page.getByRole('link', { name: /^Team/ }).click();
    await expect(page).toHaveURL(/\/team/);
    await page.getByRole('button', { name: 'Invite a teammate' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill(`invitee-${stamp}@example.test`);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(`Invitation sent to invitee-${stamp}@example.test`)).toBeVisible();
    await expect(
      page.getByRole('cell', { name: `invitee-${stamp}@example.test`, exact: true }),
    ).toBeVisible();

    // Session survives a reload (refresh cookie → access token).
    await page.reload();
    await expect(page).toHaveURL(/\/team/);
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();

    await signOut(page);
    await expect(page).toHaveURL(/\/login/);
  });

  test('protected routes redirect to login with a return path', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/settings/profile');
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fprofile/);
  });
});

async function signOut(page: Page) {
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
}
