import { expect, test } from '@playwright/test';

/**
 * Knowledge + automation journey against the REAL stack (web + api + workers + postgres + redis):
 * register → onboarding → Settings → AI (mock provider) → Knowledge: create a base, upload a .txt,
 * wait until it is ready, run a retrieval test and see a hit → Automations: create a workflow from a
 * template, validate, enable, run, see the execution succeed → Webhooks: create an outbound webhook
 * and see its secret exactly once.
 *
 * The API must run with AI_ALLOW_MOCK_PROVIDER=true and the workers must be running. If the web app
 * is a production build, build it with NEXT_PUBLIC_ENABLE_MOCK_AI=true. Enabled only when
 * E2E_BASE_URL is set.
 */
const BASE_URL = process.env.E2E_BASE_URL;
const UUID = '[0-9a-f-]{36}';

test.describe('knowledge & automation journey', () => {
  test.skip(!BASE_URL, 'Set E2E_BASE_URL to run end-to-end tests against a running stack');
  test.setTimeout(180_000);

  const stamp = Date.now();
  const email = `ka-${stamp}@example.test`;
  const password = 'E2e-Passw0rd-Strong';
  const orgName = `KA Org ${stamp}`;
  const baseName = `Handbook ${stamp}`;
  const workflowName = `Alert admins ${stamp}`;

  test('knowledge base → retrieval → workflow from template → webhook secret once', async ({
    page,
  }) => {
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

    // The navigation no longer marks these areas as "Soon".
    for (const name of ['Knowledge', 'Automations', 'Integrations']) {
      await expect(page.getByRole('link', { name: new RegExp(`^${name}$`) })).toBeVisible();
    }

    // --- Settings → AI: enable the mock provider ----------------------------------------------
    await page.goto('/settings/ai');
    await page.getByRole('button', { name: 'Add provider' }).first().click();
    const provider = page.getByRole('dialog');
    await provider.getByRole('combobox', { name: /^Provider/ }).selectOption('mock');
    await provider.getByLabel(/^Name/).fill('Mock');
    await provider.getByRole('combobox', { name: /Default model/ }).click();
    await page.getByRole('option', { name: /Mock chat model/ }).click();
    await provider.getByRole('button', { name: 'Add provider' }).click();
    await expect(page.getByText('Provider “Mock” added')).toBeVisible();

    // --- Knowledge: create a base --------------------------------------------------------------
    await page.getByRole('link', { name: /^Knowledge/ }).click();
    await expect(page).toHaveURL(/\/knowledge$/);
    await page.getByRole('button', { name: 'New knowledge base' }).first().click();
    const baseDialog = page.getByRole('dialog');
    await baseDialog.getByLabel(/^Name/).fill(baseName);
    await baseDialog.getByLabel('Description').fill('E2E documents');
    await baseDialog.getByRole('button', { name: 'Create knowledge base' }).click();
    await expect(page.getByText(`Knowledge base “${baseName}” created`)).toBeVisible();
    await page.getByRole('link', { name: baseName }).click();
    await expect(page).toHaveURL(new RegExp(`/knowledge/${UUID}$`));

    // --- Upload a small .txt and wait until it is ready ----------------------------------------
    await page.getByLabel('Choose files to upload').setInputFiles({
      name: 'refunds.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Our refund policy allows returns within thirty days of purchase.'),
    });
    const docRow = page.getByRole('row', { name: /refunds/ });
    await expect(docRow).toBeVisible({ timeout: 15_000 });
    await expect(docRow.getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });

    // --- Retrieval test -------------------------------------------------------------------------
    await page.getByRole('tab', { name: 'Retrieval test' }).click();
    await page.getByRole('textbox', { name: /^Query/ }).fill('refund policy returns thirty days');
    await page.getByRole('button', { name: 'Run search' }).click();
    const results = page.getByRole('region', { name: 'Search results' });
    await expect(
      results.getByRole('list', { name: 'Hits' }).getByRole('listitem').first(),
    ).toBeVisible();
    await expect(results).toContainText('refunds');
    await expect(results).toContainText(/Score 0\.\d+|Score 1\.000/);

    // --- Automations: workflow from a template -------------------------------------------------
    await page.getByRole('link', { name: /^Automations/ }).click();
    await page.getByRole('link', { name: 'Templates', exact: true }).click();
    await expect(page).toHaveURL(/\/automations\/templates$/);
    await page
      .getByRole('button', { name: 'Use template Alert admins from an inbound webhook' })
      .click();
    const tpl = page.getByRole('dialog');
    await tpl.getByLabel(/^Workflow name/).fill(workflowName);
    await tpl.getByRole('button', { name: 'Create workflow' }).click();
    await expect(page).toHaveURL(new RegExp(`/automations/${UUID}$`), { timeout: 15_000 });

    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByText('The workflow is valid.')).toBeVisible();

    await page.getByRole('button', { name: 'Enable workflow' }).click();
    await expect(page.getByRole('button', { name: 'Disable workflow' })).toBeVisible();

    await page.getByRole('button', { name: 'Run now' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Run workflow' }).click();
    await expect(page).toHaveURL(new RegExp(`/automations/executions/${UUID}$`), {
      timeout: 15_000,
    });
    await expect(page.getByText('Succeeded').first()).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole('list', { name: 'Step results' }).getByRole('listitem').first(),
    ).toBeVisible();

    // --- Outbound webhook: the secret is shown exactly once --------------------------------------
    await page.getByRole('link', { name: 'Webhooks' }).click();
    await expect(page).toHaveURL(/\/automations\/webhooks$/);
    await page.getByRole('button', { name: 'New webhook' }).first().click();
    const hook = page.getByRole('dialog');
    await hook.getByLabel(/^Endpoint URL/).fill('https://example.com/hooks/hilatech');
    await hook.getByRole('checkbox', { name: 'Event lead.created' }).click();
    await hook.getByRole('button', { name: 'Create webhook' }).click();

    const secretField = page.getByLabel('Signing secret');
    await expect(secretField).toBeVisible();
    const secret = await secretField.inputValue();
    expect(secret.length).toBeGreaterThanOrEqual(16);
    await expect(page.getByText(/shown only once/)).toBeVisible();
    await page.getByRole('button', { name: /I’ve saved the secret/ }).click();

    await expect(page.getByRole('row', { name: /example\.com\/hooks\/hilatech/ })).toBeVisible();
    // After closing, the secret is nowhere on the page or in a reloaded list.
    await expect(page.getByText(secret)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('row', { name: /example\.com\/hooks\/hilatech/ })).toBeVisible();
    expect(await page.content()).not.toContain(secret);
  });
});
