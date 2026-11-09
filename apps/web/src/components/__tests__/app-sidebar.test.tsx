import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Permission } from '@hilatech/contracts';
import { useSession } from '@/stores/session';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/team',
  useSearchParams: () => new URLSearchParams(),
}));

import { AppSidebar } from '@/components/shell/app-sidebar';

function renderSidebar() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AppSidebar />
    </QueryClientProvider>,
  );
}

describe('AppSidebar', () => {
  beforeEach(() => {
    useSession.setState({
      organizations: [{ id: 'org-a', name: 'Acme', slug: 'acme', logoUrl: null, roleKey: 'member', roleName: 'Member' }],
      activeOrganization: { id: 'org-a', name: 'Acme', slug: 'acme', logoUrl: null, roleKey: 'member', roleName: 'Member' },
      activeOrganizationId: 'org-a',
    });
  });

  it('hides navigation the role cannot access and marks the current page', () => {
    useSession.setState({ permissions: [Permission.MEMBERS_READ, Permission.LEADS_READ] });
    renderSidebar();
    expect(screen.getByRole('link', { name: /Team/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Leads/ })).toHaveTextContent('Soon');
    expect(screen.queryByRole('link', { name: /Roles/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Audit log/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Organization: Acme/ })).toBeInTheDocument();
  });

  it('shows organization administration for owners', () => {
    useSession.setState({
      permissions: [Permission.MEMBERS_READ, Permission.ROLES_READ, Permission.AUDIT_READ, Permission.ORG_BILLING_MANAGE],
    });
    renderSidebar();
    expect(screen.getByRole('link', { name: /Roles/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Audit log/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Billing/ })).toBeInTheDocument();
  });
});
