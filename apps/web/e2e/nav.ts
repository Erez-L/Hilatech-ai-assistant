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

/** Opens a screen the way a person does: the area in the rail first, then the screen's tab in that area. */
export async function openScreen(page: Page, screen: string) {
  const area = AREA_OF[screen];
  if (!area) throw new Error(`Unknown screen: ${screen}`);
  const areaLink = page
    .getByRole('navigation', { name: 'Areas' })
    .getByRole('link', { name: area, exact: true });
  await areaLink.click();
  // The tab row belongs to the area: wait until the area is the current one before looking for the tab.
  await expect(areaLink).toHaveAttribute('aria-current', 'true');
  const tab = page
    .getByRole('navigation', { name: `${area} screens` })
    .getByRole('link', { name: screen, exact: true });
  // An area with a single screen has no tab row: the area link already opened it.
  if ((await tab.count()) > 0) {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
  }
}
