import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission } from '@hilatech/contracts';
import { useSession } from '@/stores/session';
import { NAV_AREAS, areaFor } from '@/components/shell/nav';

let pathname = '/leads';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { AreaRail, AreaTabs } from '@/components/shell/area-nav';

describe('area navigation', () => {
  beforeEach(() => {
    pathname = '/leads';
    useSession.setState({
      permissions: [
        Permission.LEADS_READ,
        Permission.CONTACTS_READ,
        Permission.DEALS_READ,
        Permission.MEMBERS_READ,
      ],
    });
  });

  it('every screen belongs to exactly one area', () => {
    const hrefs = NAV_AREAS.flatMap((a) => a.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(areaFor('/settings/billing')?.key).toBe('organization');
    expect(areaFor('/deals/pipelines')?.key).toBe('sales');
    expect(areaFor('/tasks')?.key).toBe('today');
  });

  it('side rail lists only the areas the role can open, each with its permitted screens', () => {
    render(<AreaRail placement="side" />);
    const rail = screen.getByRole('navigation', { name: 'Areas' });
    // Today (dashboard needs no permission), Customers, Sales, Organization; no AI and no Operations.
    expect(
      within(rail)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Today', 'Customers', 'Sales', 'Organization']);
    const customers = within(rail).getByRole('region', { name: 'Customers' });
    expect(
      within(customers)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Leads', 'Contacts']);
    expect(within(rail).getByRole('link', { name: 'Leads' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(rail).getByRole('link', { name: 'Deals' })).not.toHaveAttribute('aria-current');
    const hrefs = within(rail)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('bottom bar has one link per area, opening its first screen, and marks the current area', () => {
    render(<AreaRail placement="bottom" />);
    const bar = screen.getByRole('navigation', { name: 'Areas' });
    expect(
      within(bar)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Today', 'Customers', 'Sales', 'Organization']);
    const customers = within(bar).getByRole('link', { name: 'Customers' });
    expect(customers).toHaveAttribute('aria-current', 'true');
    expect(customers).toHaveAttribute('href', '/leads');
    expect(within(bar).getByRole('link', { name: 'Organization' })).toHaveAttribute(
      'href',
      '/team',
    );
  });

  it('lists the permitted screens of the current area as tabs', () => {
    render(<AreaTabs />);
    const tabs = screen.getByRole('navigation', { name: 'Customers screens' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Leads', 'Contacts']);
    expect(within(tabs).getByRole('link', { name: 'Leads' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows no tab row for an area with a single screen', () => {
    pathname = '/deals';
    const { container } = render(<AreaTabs />);
    expect(container).toBeEmptyDOMElement();
  });
});
