import { expect, test, type Page } from '@playwright/test';
import type { en } from '../src/i18n/messages/en';
import { he } from '../src/i18n/messages/he';

/**
 * Sales journey (Phase 7): register → onboarding → task (create, complete) → deal (create, Move to…, drag,
 * totals) → company (create, link a contact) → CSV import with Hebrew content (dry run → execute → result) →
 * CSV export download → the same screens in Hebrew / RTL.
 *
 * Requires the full stack (web + api + postgres + redis). Enabled only when E2E_BASE_URL is set.
 */
const BASE_URL = process.env.E2E_BASE_URL;
const UUID = '[0-9a-f-]{36}';

type Key = keyof typeof en;
const H = (k: Key) => String(he[k]);

async function openNav(page: Page, name: string | RegExp) {
  await page
    .getByRole('navigation')
    .getByRole('link', { name })
    .first()
    .click();
}

test.describe('sales journey', () => {
  test.skip(!BASE_URL, 'Set E2E_BASE_URL to run end-to-end tests against a running stack');
  test.describe.configure({ mode: 'serial' });

  const stamp = Date.now();
  const email = `sales-${stamp}@example.test`;
  const password = 'E2e-Passw0rd-Strong';
  const orgName = `Sales Org ${stamp}`;
  const taskTitle = `Call Dana about the quote ${stamp}`;
  const dealTitle = `Annual plan ${stamp}`;
  const companyName = `Acme Ltd ${stamp}`;
  const contactEmail = `noa-${stamp}@example.test`;
  const hebrewFirst = 'דנה';
  const hebrewLast = `כהן${stamp}`;
  const importedEmail = `dana-he-${stamp}@example.test`;

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test('register and create the organization', async () => {
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
    await expect(page.getByText('Open leads').first()).toBeVisible();
  });

  test('tasks: create, see it, complete it', async () => {
    await openNav(page, /^Tasks/);
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
    await expect(page.getByText('No tasks yet')).toBeVisible();

    await page.getByRole('button', { name: 'New task' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Title/).fill(taskTitle);
    await dialog.getByLabel('Priority').selectOption('high');
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText(`Task “${taskTitle}” created`)).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(taskTitle) });
    await expect(row).toBeVisible();
    await expect(row).toContainText('High');
    await expect(row).toContainText('Manual');

    await row.getByRole('button', { name: `Mark “${taskTitle}” as done` }).click();
    await expect(page.getByText(`“${taskTitle}” completed`)).toBeVisible();
    // The default filter shows open tasks only, so the completed one disappears from it.
    await expect(page.getByRole('row', { name: new RegExp(taskTitle) })).toHaveCount(0);

    // Switch the status filter to Done: it is back, and can be reopened.
    await page.getByLabel('Status', { exact: true }).selectOption('done');
    const done = page.getByRole('row', { name: new RegExp(taskTitle) });
    await expect(done).toBeVisible();
    await done.getByRole('button', { name: `Reopen “${taskTitle}”` }).click();
    await expect(page.getByText(`“${taskTitle}” reopened`)).toBeVisible();
  });

  test('deals: create, move with the "Move to…" menu, totals per column', async () => {
    await openNav(page, /^Deals/);
    await expect(page).toHaveURL(/\/deals$/);
    await expect(page.getByRole('heading', { name: 'Deals', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'New deal' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Title/).fill(dealTitle);
    await dialog.getByLabel(/^Value/).fill('5000');
    await dialog.getByRole('button', { name: 'Create deal' }).click();
    await expect(page.getByText(`Deal “${dealTitle}” created`)).toBeVisible();

    const board = page.getByTestId('deal-board');
    await expect(board).toBeVisible();
    const lead = board.getByTestId('deal-column').filter({ hasText: 'Lead' }).first();
    await expect(lead.getByTestId('deal-card').filter({ hasText: dealTitle })).toBeVisible();
    await expect(lead.getByTestId('column-count')).toHaveText('1');
    await expect(lead.getByTestId('column-totals')).toContainText('5,000');

    // Keyboard-friendly move: open the card menu and choose a stage.
    await page.getByRole('button', { name: `Move “${dealTitle}” to…` }).click();
    await page.getByRole('menuitem', { name: 'Proposal' }).click();
    await expect(page.getByText(`“${dealTitle}” moved to Proposal`)).toBeVisible();

    const proposal = board.getByTestId('deal-column').filter({ hasText: 'Proposal' }).first();
    await expect(proposal.getByTestId('deal-card').filter({ hasText: dealTitle })).toBeVisible();
    await expect(proposal.getByTestId('column-count')).toHaveText('1');
    await expect(proposal.getByTestId('column-totals')).toContainText('5,000');
    await expect(lead.getByTestId('column-count')).toHaveText('0');

    // Drag and drop to the next column (native HTML5 DnD).
    const card = proposal.getByTestId('deal-card').filter({ hasText: dealTitle });
    const negotiation = board.getByTestId('deal-column').filter({ hasText: 'Negotiation' }).first();
    // Make sure both columns are inside the scrollable board before pressing the mouse (a 6-column board is wider than the viewport).
    await negotiation.scrollIntoViewIfNeeded();
    await card.scrollIntoViewIfNeeded();
    const from = (await card.boundingBox())!;
    const to = (await negotiation.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 10, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 10 });
    await page.mouse.up();
    await expect(negotiation.getByTestId('deal-card').filter({ hasText: dealTitle })).toBeVisible();
    await expect(negotiation.getByTestId('column-count')).toHaveText('1');
  });

  test('deals: detail page with stage history, notes and tasks; lost needs a reason prompt', async () => {
    await page.getByTestId('deal-card').filter({ hasText: dealTitle }).getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/deals/${UUID}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(dealTitle);
    await expect(page.getByTestId('stage-history')).toContainText('Negotiation');

    await page.getByRole('textbox', { name: 'New note' }).fill('Sent the revised quote');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByTestId('deal-note')).toContainText('Sent the revised quote');

    // Mark as lost → reason prompt.
    await page.getByRole('button', { name: 'Move to…' }).click();
    await page.getByRole('menuitem', { name: 'Lost' }).click();
    const prompt = page.getByRole('dialog');
    await prompt.getByLabel('Lost reason').fill('Budget frozen');
    await prompt.getByRole('button', { name: 'Mark as lost' }).click();
    await expect(page.getByText('Budget frozen').first()).toBeVisible();
  });

  test('companies: create and link a contact', async () => {
    // A contact to link.
    await openNav(page, /^Contacts/);
    await page.getByRole('button', { name: 'New contact' }).first().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('First name').fill('Noa');
    await dialog.getByLabel('Last name').fill('Levi');
    await dialog.getByLabel('Email').fill(contactEmail);
    await dialog.getByRole('button', { name: 'Create contact' }).click();
    await expect(page).toHaveURL(new RegExp(`/contacts/${UUID}$`));

    await openNav(page, /^Companies/);
    await expect(page).toHaveURL(/\/companies$/);
    await page.getByRole('button', { name: 'New company' }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Name/).fill(companyName);
    await dialog.getByLabel('Domain').fill(`acme${stamp}.test`);
    await dialog.getByRole('button', { name: 'Create company' }).click();
    await expect(page.getByText(`Company “${companyName}” created`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/companies/${UUID}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(companyName);
    await expect(page.getByText('No contacts linked yet')).toBeVisible();

    await page.getByRole('combobox', { name: 'Link a contact' }).click();
    await page.getByPlaceholder('Type a name, email or company').fill('Noa');
    await page.getByRole('option', { name: /Noa Levi/ }).click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByText('Contact linked to the company')).toBeVisible();
    await expect(page.getByRole('link', { name: /Noa Levi/ })).toBeVisible();

    // The contact page shows the company record.
    await page.getByRole('link', { name: /Noa Levi/ }).click();
    await expect(page.getByRole('link', { name: companyName })).toBeVisible();
  });

  test('import a CSV with Hebrew content: dry run → execute → result', async () => {
    await openNav(page, /^Imports/);
    await expect(page).toHaveURL(/\/imports$/);
    await expect(page.getByText('No imports yet')).toBeVisible();
    await page.getByRole('button', { name: 'New import' }).first().click();

    const wizard = page.getByTestId('import-wizard');
    await expect(wizard).toBeVisible();
    await wizard.getByLabel('What are you importing?').selectOption('contacts');
    const csv = [
      'שם פרטי,שם משפחה,אימייל,טלפון',
      `${hebrewFirst},${hebrewLast},${importedEmail},050-1234567`,
      `Not An Email,Broken,not-an-email,`,
      `${hebrewFirst},${hebrewLast} השני,${importedEmail},`,
    ].join('\n');
    await wizard.getByLabel('CSV file').setInputFiles({
      name: 'contacts-he.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await wizard.getByRole('button', { name: 'Upload and continue' }).click();

    // Mapping: Hebrew headers were mapped by the suggestion.
    await expect(wizard.getByTestId('import-detected')).toBeVisible();
    await expect(wizard.getByRole('combobox', { name: 'First name', exact: true })).toHaveValue('0');
    await expect(wizard.getByRole('combobox', { name: 'Email', exact: true })).toHaveValue('2');
    await wizard.getByRole('button', { name: 'Check file (dry run)' }).click();

    // Dry run.
    const review = wizard.getByTestId('import-review');
    await expect(review).toBeVisible();
    await expect(wizard.getByTestId('validation-total')).toContainText('3');
    await expect(wizard.getByTestId('validation-invalid')).toContainText('1');
    await expect(wizard.getByTestId('validation-duplicates')).toContainText('1');
    await wizard.getByRole('button', { name: 'Run import' }).click();

    // Progress → result.
    const result = wizard.getByTestId('import-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(wizard.getByTestId('import-created')).toContainText('1');
    await expect(wizard.getByTestId('import-failed')).toContainText('1');
    const download = page.waitForEvent('download');
    await wizard.getByRole('button', { name: /Download report/ }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await wizard.getByRole('button', { name: 'Done' }).click();

    // History shows the finished import, and the contact exists with its Hebrew name.
    await expect(page.getByRole('row', { name: /contacts-he\.csv/ })).toContainText('Completed');
    await openNav(page, /^Contacts/);
    await page.locator('#contacts-search').fill(hebrewLast);
    await expect(page.getByRole('link', { name: `${hebrewFirst} ${hebrewLast}`, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Noa Levi' })).toHaveCount(0);
  });

  test('export: the contacts list downloads a CSV honoring the search filter', async () => {
    await expect(page).toHaveURL(/\/contacts/);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Contacts as CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/contacts.*\.csv$/);
    const stream = await file.createReadStream();
    let body = '';
    for await (const chunk of stream) body += chunk.toString('utf8');
    expect(body).toContain(importedEmail);
    expect(body).not.toContain(contactEmail);
  });

  test('profile: the notification switches are accepted by the API (per-type maps)', async () => {
    await page.goto('/settings/profile');
    const requests: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/notifications/preferences') && r.request().method() === 'PUT') requests.push(r.status());
    });
    const email = page.getByRole('switch', { name: 'Email notifications' });
    await expect(email).toBeEnabled();
    await expect(email).toBeChecked();
    await email.click();
    await expect(page.getByText('Preferences saved').first()).toBeVisible();
    await expect(email).not.toBeChecked();
    expect(requests).toEqual([200]);
    await email.click();
    await expect(email).toBeChecked();
  });

  test('hebrew / rtl: tasks, deals, companies and imports mirror and speak Hebrew', async () => {
    await page.goto('/settings/profile');
    await page.getByLabel('Language', { exact: true }).selectOption('he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    for (const [path, title] of [
      ['/tasks', H('shell.tasks')],
      ['/deals', H('shell.deals')],
      ['/companies', H('shell.companies')],
      ['/imports', H('shell.imports')],
    ] as const) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    }

    // The board is mirrored (first column on the right) and the move menu speaks Hebrew.
    await page.goto('/deals');
    const columns = page.getByTestId('deal-column');
    await expect(columns.first()).toBeVisible();
    const first = await columns.first().boundingBox();
    const last = await columns.last().boundingBox();
    expect(first!.x).toBeGreaterThan(last!.x);

    await page.goto('/tasks');
    await page.getByRole('button', { name: H('tasks.newTask') }).first().click();
    await expect(page.getByRole('dialog').getByLabel(H('tasks.priority'))).toBeVisible();
  });
});
