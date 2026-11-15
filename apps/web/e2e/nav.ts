import { expect, type Page } from '@playwright/test';

/** Area that owns each screen (English labels), mirroring `src/components/shell/nav.ts`. */
const AREA_OF: Record<string, string> = {
  Dashboard: 'Today',
  Tasks: 'Today',
  Reports: 'Today',
  Leads: 'Customers',
  Contacts: 'Customers',
  Companies: 'Customers',
  Conversations: 'Customers',
  Deals: 'Sales',
  Assistant: 'AI',
  Agents: 'AI',
  Knowledge: 'AI',
  Evaluations: 'AI',
  Automations: 'Operations',
  Integrations: 'Operations',
  Imports: 'Operations',
  Team: 'Organization',
  Roles: 'Organization',
  'Audit log': 'Organization',
  Settings: 'Organization',
};

/** Opens a screen the way a person does on a wide screen: its link in the areas rail. */
export async function openScreen(page: Page, screen: string) {
  if (!AREA_OF[screen]) throw new Error(`Unknown screen: ${screen}`);
  const link = page
    .getByRole('navigation', { name: 'Areas' })
    .getByRole('region', { name: AREA_OF[screen] })
    .getByRole('link', { name: screen, exact: true });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
}
