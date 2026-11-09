import { expect, test } from '@playwright/test';

/**
 * AI platform journey: register → onboarding → Settings → AI (add the `mock` provider) → Assistant
 * ("hello" → "mock: hello") → create an agent with `time.now` → run it synchronously → execution
 * detail shows Succeeded with steps → Settings → AI usage shows at least one request.
 *
 * Requires the full stack (web + api + postgres + redis) with the API in development mode (the mock
 * provider is refused in production). If the web app runs as a production build, start it with
 * NEXT_PUBLIC_ENABLE_MOCK_AI=true so the provider select offers "Mock". Enabled only when
 * E2E_BASE_URL is set.
 */
const BASE_URL = process.env.E2E_BASE_URL;
const UUID = '[0-9a-f-]{36}';

test.describe('ai journey', () => {
  test.skip(!BASE_URL, 'Set E2E_BASE_URL to run end-to-end tests against a running stack');

  const stamp = Date.now();
  const email = `ai-${stamp}@example.test`;
  const password = 'E2e-Passw0rd-Strong';
  const orgName = `AI Org ${stamp}`;
  const agentName = `Clock agent ${stamp}`;

  test('provider → assistant → agent → sync run → usage', async ({ page }) => {
    // --- Register and create the organization -------------------------------------------------
    await page.goto('/register');
    await page.getByLabel('First name').fill('Erez');
    await page.getByLabel('Last name').fill('Tester');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel('Organization name').fill(orgName);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // --- Settings → AI: add the mock provider -------------------------------------------------
    await page.getByRole('link', { name: /^Settings/ }).click();
    await page.getByRole('link', { name: 'AI', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/ai$/);
    await expect(page.getByText('No AI provider yet')).toBeVisible();
    await page.getByRole('button', { name: 'Add provider' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: /^Provider/ }).selectOption('mock');
    await dialog.getByLabel(/^Name/).fill('Mock');
    await dialog.getByRole('combobox', { name: /Default model/ }).click();
    await page.getByRole('option', { name: /Mock chat model/ }).click();
    await dialog.getByRole('button', { name: 'Add provider' }).click();
    await expect(page.getByText('Provider “Mock” added')).toBeVisible();
    const providerRow = page.getByRole('row', { name: /Mock/ }).filter({ hasText: 'mock-chat' });
    await expect(providerRow.getByText('Default', { exact: true })).toBeVisible();

    // --- Assistant ----------------------------------------------------------------------------
    await page.getByRole('link', { name: /^Assistant/ }).click();
    await expect(page).toHaveURL(/\/assistant/);
    await page.getByRole('button', { name: 'New thread' }).first().click();
    await expect(page).toHaveURL(new RegExp(`t=${UUID}`));
    const box = page.getByRole('textbox', { name: 'Message the assistant' });
    await box.fill('hello');
    await box.press('Enter');
    await expect(page.getByRole('log', { name: 'Messages' }).getByText('mock: hello')).toBeVisible({
      timeout: 30_000,
    });

    // --- Agents: create with the time.now tool -------------------------------------------------
    await page.getByRole('link', { name: /^Agents/ }).click();
    await expect(page).toHaveURL(/\/agents$/);
    await page.getByRole('link', { name: 'New agent' }).first().click();
    await expect(page).toHaveURL(/\/agents\/new$/);
    await page.getByLabel(/^Name/).fill(agentName);
    await page.getByLabel(/^Instructions/).fill('Tell the user the current time.');
    await page.getByRole('checkbox', { name: /time\.now/ }).click();
    await page.getByRole('button', { name: 'Create agent' }).click();
    await expect(page.getByText(`Agent “${agentName}” created`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/agents/${UUID}$`));

    // --- Run synchronously ---------------------------------------------------------------------
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const run = page.getByRole('dialog');
    await run.getByRole('textbox', { name: /^Input/ }).fill('What time is it?');
    await run.getByRole('radio', { name: /Wait for result/ }).click();
    await run.getByRole('button', { name: 'Run agent' }).click();
    await expect(page).toHaveURL(new RegExp(`/agents/executions/${UUID}$`), { timeout: 90_000 });
    await expect(page.getByText('Succeeded').first()).toBeVisible({ timeout: 30_000 });
    const steps = page.getByRole('list', { name: 'Steps' });
    await expect(steps.getByRole('listitem').first()).toBeVisible();

    // --- Usage ---------------------------------------------------------------------------------
    await page.goto('/settings/ai');
    const byModel = page.getByRole('region', { name: 'By model' });
    const modelRow = byModel.getByRole('row', { name: /mock-chat/ });
    await expect(modelRow).toBeVisible({ timeout: 15_000 });
    const requests = Number(
      (await modelRow.getByRole('cell').nth(1).innerText()).replace(/,/g, ''),
    );
    expect(requests).toBeGreaterThanOrEqual(1);
  });
});
