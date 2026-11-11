import { expect, test } from '@playwright/test';

/**
 * Analytics + billing journey against the REAL stack (web + api + workers + postgres + redis):
 * register → onboarding → mock AI provider + one assistant message (so usage exists) → /analytics:
 * the nav entry is live, every tab (Business, Sales, Agent performance, Automation, Usage) renders,
 * granularity changes, the usage CSV downloads → Settings → Billing: plan + entitlements, upgrade
 * options, a tiny token budget with hard stop → the assistant refuses with a budget message that
 * links to billing → Upgrade answers "payment is not configured" (501, nothing is charged).
 *
 * The API must run with AI_ALLOW_MOCK_PROVIDER=true. If the web app is a production build, build it
 * with NEXT_PUBLIC_ENABLE_MOCK_AI=true. Enabled only when E2E_BASE_URL is set.
 */
const BASE_URL = process.env.E2E_BASE_URL;
const UUID = '[0-9a-f-]{36}';

test.describe('analytics & billing journey', () => {
  test.skip(!BASE_URL, 'Set E2E_BASE_URL to run end-to-end tests against a running stack');
  test.setTimeout(180_000);

  const stamp = Date.now();
  const email = `ab-${stamp}@example.test`;
  const password = 'E2e-Passw0rd-Strong';
  const orgName = `AB Org ${stamp}`;

  test('analytics tabs → usage export → entitlements → budget hard stop → 402 message → checkout not configured', async ({
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

    // --- Mock provider + one assistant message so the usage report has data -------------------
    await page.goto('/settings/ai');
    await page.getByRole('button', { name: 'Add provider' }).first().click();
    const provider = page.getByRole('dialog');
    await provider.getByRole('combobox', { name: /^Provider/ }).selectOption('mock');
    await provider.getByLabel(/^Name/).fill('Mock');
    await provider.getByRole('combobox', { name: /Default model/ }).click();
    await page.getByRole('option', { name: /Mock chat model/ }).click();
    await provider.getByRole('button', { name: 'Add provider' }).click();
    await expect(page.getByText('Provider “Mock” added')).toBeVisible();

    await page.getByRole('link', { name: /^Assistant/ }).click();
    await page.getByRole('button', { name: 'New thread' }).first().click();
    await expect(page).toHaveURL(new RegExp(`t=${UUID}`));
    const box = page.getByRole('textbox', { name: 'Message the assistant' });
    await box.fill('hello');
    await box.press('Enter');
    const log = page.getByRole('log', { name: 'Messages' });
    await expect(log.getByText('mock: hello')).toBeVisible({ timeout: 30_000 });

    // --- Analytics: the nav entry is live and every tab renders --------------------------------
    const nav = page.getByRole('link', { name: /^Analytics/ });
    await expect(nav).toBeVisible();
    await expect(nav).not.toContainText('Soon');
    await nav.click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();

    // Business: tiles, funnel and the task statistics (the Task model exists).
    await expect(page.getByText('Leads created', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Lead funnel' })).toBeVisible();
    const taskStats = page.getByTestId('tasks-stats');
    await expect(taskStats).toBeVisible();
    await expect(taskStats).toContainText('Open tasks');
    await expect(taskStats).toContainText('Overdue');
    await expect(taskStats).toContainText('Due today');
    await expect(taskStats).toContainText('Completed in range');
    await expect(page.getByTestId('tasks-not-modelled')).toHaveCount(0);

    // Granularity and range controls are labelled and change the summary line.
    await page.getByRole('radio', { name: 'Week' }).click();
    await expect(page.getByTestId('analytics-range-summary')).toContainText('grouped by week');
    await page.getByRole('radio', { name: '7 days' }).click();
    await expect(page.getByTestId('analytics-range-summary')).toContainText('UTC');

    // Sales: this org has no deals yet, so the figures are derived from leads and say so.
    await page.getByRole('tab', { name: 'Sales' }).click();
    await expect(page.getByTestId('deals-not-modelled')).toContainText('derived from leads');
    await expect(page.getByText('Win rate', { exact: true })).toBeVisible();

    // Agent performance: no runs yet → empty state; no pricing → honest cost note.
    await page.getByRole('tab', { name: 'Agent performance' }).click();
    await expect(page.getByText('No agent runs in this range')).toBeVisible();
    await expect(page.getByTestId('agents-cost-note')).toContainText('No model pricing');

    // Automation: nothing fired yet.
    await page.getByRole('tab', { name: 'Automation' }).click();
    await expect(page.getByText('No automation activity in this range')).toBeVisible();

    // Usage: the assistant call is counted; cost is not invented; CSV downloads.
    await page.getByRole('tab', { name: 'Usage' }).click();
    await expect(page.getByText('AI requests', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Usage by model' })).toContainText('mock-chat');
    await expect(page.getByTestId('usage-cost-note')).toContainText('No model pricing');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export usage time series as CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^usage-series-.*\.csv$/);

    // --- Billing: plan, entitlements, upgrade options ------------------------------------------
    await page.goto('/settings/billing');
    await expect(page.getByRole('heading', { name: 'Plan usage' })).toBeVisible();
    const entitlements = page.getByRole('list', { name: 'Entitlements' });
    await expect(entitlements.getByTestId('entitlement-seats')).toContainText('Team seats');
    await expect(entitlements.getByTestId('entitlement-ai_tokens')).toContainText('AI tokens');
    await expect(entitlements.getByRole('meter', { name: 'Team seats usage' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Higher plans' })).toBeVisible();
    await expect(page.getByTestId('upgrade-starter')).toContainText('Pricing not configured');

    // --- Budget: a tiny token budget with the hard stop on --------------------------------------
    await page.getByLabel('Monthly token budget').fill('1');
    await page.getByRole('switch', { name: /Hard stop/ }).click();
    await page.getByRole('button', { name: 'Save budget' }).click();
    await expect(page.getByText('Budget saved.')).toBeVisible();
    await expect(page.getByTestId('budget-blocked')).toBeVisible();

    // The API raises the alert synchronously on PUT /billing/budget; reload once so the list is
    // refetched, then wait for the table to render (a bare `.count()` right after a reload races
    // with the query that fills the table).
    await page.reload();
    await expect(page.getByRole('table', { name: 'Budget alerts' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('table', { name: 'Budget alerts' })).toContainText(
      'AI token budget',
    );

    // --- The assistant now refuses with a clear message that links back to billing -------------
    await page.getByRole('link', { name: /^Assistant/ }).click();
    await page.getByRole('button', { name: 'New thread' }).first().click();
    await expect(page).toHaveURL(new RegExp(`t=${UUID}`));
    const box2 = page.getByRole('textbox', { name: 'Message the assistant' });
    await box2.fill('are you still there?');
    await box2.press('Enter');
    const budgetAlert = page.getByTestId('budget-exceeded');
    await expect(budgetAlert).toContainText('Monthly AI budget reached', { timeout: 30_000 });
    await budgetAlert.getByRole('link', { name: 'Review budget in Billing' }).click();
    await expect(page).toHaveURL(/\/settings\/billing$/);

    // --- Upgrade: checkout answers "payment is not configured" ---------------------------------
    await page.getByRole('button', { name: 'Upgrade to Starter' }).click();
    const notConfigured = page.getByTestId('payment-not-configured');
    await expect(notConfigured).toContainText('Payment is not configured');
    await expect(notConfigured).toContainText('plan has not changed');
  });
});
