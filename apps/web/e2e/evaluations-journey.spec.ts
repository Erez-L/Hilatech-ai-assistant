import { expect, test } from '@playwright/test';

/**
 * Evaluations journey: register → mock provider → agent → dataset with a passing and a failing
 * case → run → the workers execute both cases → results page shows 1 of 2 passed.
 * Requires the full stack including the workers. Enabled only when E2E_BASE_URL is set.
 */
const BASE_URL = process.env.E2E_BASE_URL;

test.describe('evaluations journey', () => {
  test.skip(!BASE_URL, 'Set E2E_BASE_URL to run end-to-end tests against a running stack');

  const stamp = Date.now();
  const agentName = `Eval agent ${stamp}`;

  test('dataset → cases → run → per-case results', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('First name').fill('Erez');
    await page.getByLabel('Last name').fill('Tester');
    await page.getByLabel('Work email').fill(`eval-${stamp}@example.test`);
    await page.getByLabel(/^Password/).fill('E2e-Passw0rd-Strong');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel('Organization name').fill(`Eval Org ${stamp}`);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Mock provider (answers "mock: <input>").
    await page.goto('/settings/ai');
    await page.getByRole('button', { name: 'Add provider' }).first().click();
    const providerDialog = page.getByRole('dialog');
    await providerDialog.getByRole('combobox', { name: /^Provider/ }).selectOption('mock');
    await providerDialog.getByLabel(/^Name/).fill('Mock');
    await providerDialog.getByRole('combobox', { name: /Default model/ }).click();
    await page.getByRole('option', { name: /Mock chat model/ }).click();
    await providerDialog.getByRole('button', { name: 'Add provider' }).click();
    await expect(page.getByText('Provider “Mock” added')).toBeVisible();

    // Agent.
    await page.goto('/agents/new');
    await page.getByLabel(/^Name/).fill(agentName);
    await page.getByLabel(/^Instructions/).fill('Answer the question.');
    await page.getByRole('button', { name: 'Create agent' }).click();
    await expect(page.getByText(/created/i).first()).toBeVisible();

    // Dataset.
    await page.getByRole('link', { name: /^Evaluations/ }).click();
    await expect(page).toHaveURL(/\/evaluations$/);
    await expect(page.getByText('No evaluation datasets yet')).toBeVisible();
    await page.getByRole('button', { name: 'New dataset' }).first().click();
    await page.getByRole('dialog').getByLabel(/^Name/).fill('Greeting checks');
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/evaluations\/[0-9a-f-]{36}$/);

    const addCase = async (name: string, input: string, expected: string) => {
      await page.getByRole('button', { name: 'Add case' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/^Case name/).fill(name);
      await dialog.getByLabel(/^Input sent to the agent/).fill(input);
      await dialog.getByLabel('Expected text or pattern').fill(expected);
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Case saved').first()).toBeVisible();
      await expect(dialog).toBeHidden();
    };
    await addCase('Says hello', 'Say hello', 'hello');
    await addCase('Mentions a refund', 'Say hello', 'refund');
    await expect(page.getByText('Says hello')).toBeVisible();
    await expect(page.getByText('Mentions a refund')).toBeVisible();

    // Run.
    await page.getByRole('combobox', { name: 'Agent' }).selectOption({ label: agentName });
    await page.getByRole('button', { name: 'Run evaluation' }).click();
    await expect(page.getByText('Evaluation started')).toBeVisible();
    const runRow = page.getByRole('row', { name: new RegExp(agentName) });
    await expect(runRow.getByText('Completed')).toBeVisible({ timeout: 30_000 });
    await expect(runRow.getByText('1 of 2 passed (50%)')).toBeVisible();

    // Results.
    await runRow.getByRole('link', { name: 'View results' }).click();
    await expect(page).toHaveURL(/\/evaluations\/runs\/[0-9a-f-]{36}$/);
    await expect(page.getByText('50%')).toBeVisible();
    await expect(page.getByText('mock: Say hello').first()).toBeVisible();
    const cards = page.getByRole('listitem').filter({ hasText: 'Agent answer' });
    await expect(
      cards.filter({ hasText: 'Says hello' }).getByText('Passed', { exact: true }),
    ).toBeVisible();
    await expect(
      cards.filter({ hasText: 'Mentions a refund' }).getByText('Failed', { exact: true }),
    ).toBeVisible();
  });
});
