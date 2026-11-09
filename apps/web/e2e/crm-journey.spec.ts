import { expect, test, type Page } from '@playwright/test';

/**
 * CRM journey: register → onboarding → create contact → create lead → assign to self → add note →
 * convert (mark won) → start conversation → send message → see it in the thread → the bell shows
 * nothing for a self-assignment.
 *
 * Requires the full stack (web + api + postgres + redis). Enabled only when E2E_BASE_URL is set.
 */
const BASE_URL = process.env.E2E_BASE_URL;
const UUID = '[0-9a-f-]{36}';

test.describe('crm journey', () => {
  test.skip(!BASE_URL, 'Set E2E_BASE_URL to run end-to-end tests against a running stack');

  const stamp = Date.now();
  const email = `crm-${stamp}@example.test`;
  const password = 'E2e-Passw0rd-Strong';
  const orgName = `CRM Org ${stamp}`;
  const contactEmail = `dana-${stamp}@example.test`;
  const leadTitle = `Website redesign ${stamp}`;
  const noteText = `Called Dana, very interested (${stamp})`;
  const firstMessage = `Hi Dana, here is the proposal (${stamp})`;
  const reply = `Following up on pricing (${stamp})`;

  test('contact → lead → assign → note → convert → conversation → message', async ({ page }) => {
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
    await expect(page.getByText('Open leads').first()).toBeVisible();

    // --- Contact ------------------------------------------------------------------------------
    await page.getByRole('link', { name: /^Contacts/ }).click();
    await expect(page).toHaveURL(/\/contacts$/);
    await page.getByRole('button', { name: 'New contact' }).first().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('First name').fill('Dana');
    await dialog.getByLabel('Last name').fill('Cohen');
    await dialog.getByLabel('Email').fill(contactEmail);
    await dialog.getByLabel('Company').fill('Acme');
    await dialog.getByRole('button', { name: 'Create contact' }).click();
    await expect(page.getByText('Dana Cohen added to contacts')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/contacts/${UUID}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Dana Cohen');

    // --- Lead ---------------------------------------------------------------------------------
    await page.getByRole('link', { name: /^Leads/ }).click();
    await expect(page).toHaveURL(/\/leads$/);
    await page.getByRole('button', { name: 'New lead' }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Title/).fill(leadTitle);
    await dialog.getByLabel(/^Value/).fill('1200');
    await dialog.getByRole('combobox', { name: 'Contact' }).click();
    await page.getByPlaceholder('Type a name, email or company').fill('Dana');
    await page.getByRole('option', { name: /Dana Cohen/ }).click();
    await dialog.getByRole('button', { name: 'Create lead' }).click();
    await expect(page.getByText(`Lead “${leadTitle}” created`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/leads/${UUID}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(leadTitle);
    await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveAttribute(
      'aria-current',
      'step',
    );

    // --- Assign to self -----------------------------------------------------------------------
    await page.getByRole('button', { name: 'Assignee: unassigned' }).click();
    await page.getByRole('menuitem', { name: 'Assign to me' }).click();
    await expect(page.getByText('Assigned to Erez Tester')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Assignee: Erez Tester' })).toBeVisible();

    // --- Note ---------------------------------------------------------------------------------
    await page.getByRole('textbox', { name: 'New note' }).fill(noteText);
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText(noteText).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'New note' })).toHaveValue('');

    // --- Convert (link the existing contact, mark as won) --------------------------------------
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio', { name: /Link an existing contact/ })).toBeChecked();
    await expect(dialog.getByRole('combobox', { name: 'Contact' })).toContainText('Dana Cohen');
    await dialog.getByRole('checkbox', { name: /Mark as won/ }).click();
    await dialog.getByRole('button', { name: 'Convert lead' }).click();
    await expect(page.getByText(/Lead converted/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Won', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Won');

    // --- Start a conversation from the lead ----------------------------------------------------
    await page.getByRole('button', { name: 'Start conversation' }).first().click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Subject')).toHaveValue(leadTitle);
    await expect(dialog.getByRole('combobox', { name: 'Contact' })).toContainText('Dana Cohen');
    await expect(dialog.getByRole('combobox', { name: 'Lead' })).toContainText(leadTitle);
    await dialog.getByLabel('First message').fill(firstMessage);
    await dialog.getByRole('button', { name: 'Start conversation' }).click();
    await expect(page.getByText('Conversation started')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/conversations\\?c=${UUID}$`));

    const thread = page.getByRole('log', { name: 'Messages' });
    await expect(thread.getByText(firstMessage)).toBeVisible();

    // --- Reply: Enter sends; the message appears in the thread -----------------------------------
    const composer = page.getByRole('textbox', { name: 'Reply' });
    await composer.fill(reply);
    await composer.press('Enter');
    await expect(thread.getByText(reply)).toBeVisible();
    await expect(composer).toHaveValue('');
    // The list preview reflects the latest message.
    await expect(page.getByRole('list', { name: 'Conversations' })).toContainText(reply);

    // --- Notifications: assigning yourself produces nothing ------------------------------------
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByText('You’re all caught up.')).toBeVisible();
    await page.keyboard.press('Escape');

    // --- Dashboard reflects the new data --------------------------------------------------------
    await page.getByRole('link', { name: /^Dashboard/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const recentLead = page.locator('a[href^="/leads/"]').filter({ hasText: leadTitle });
    await expect(recentLead).toBeVisible();
    await expect(recentLead).toHaveAttribute('href', new RegExp(`/leads/${UUID}$`));
    await expect(
      page.locator('a[href^="/conversations"]').filter({ hasText: leadTitle }),
    ).toBeVisible();

    await signOut(page);
    await expect(page).toHaveURL(/\/login/);
  });
});

async function signOut(page: Page) {
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
}
