import * as React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@hilatech/ui';
import type { AuthUser, OrganizationSummary } from '@hilatech/contracts';
import { useSession } from '@/stores/session';
import { I18nProvider } from '@/i18n/provider';
import type { Locale } from '@/i18n/config';

export const TEST_USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'noa@example.com',
  firstName: 'Noa',
  lastName: 'Levi',
  avatarUrl: null,
  emailVerifiedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const TEST_ORG: OrganizationSummary = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Acme',
  slug: 'acme',
  logoUrl: null,
  roleKey: 'owner',
  roleName: 'Owner',
};

/** Puts an authenticated session with the given permissions into the store. */
export function seedSession(permissions: string[], user: AuthUser = TEST_USER) {
  useSession.setState({
    status: 'authenticated',
    accessToken: 'tok',
    user,
    organizations: [TEST_ORG],
    activeOrganizationId: TEST_ORG.id,
    activeOrganization: TEST_ORG,
    permissions,
    sessionLoaded: true,
  });
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderOptions & { queryClient?: QueryClient; locale?: Locale } = {},
) {
  const { queryClient = makeQueryClient(), locale = 'en', ...rest } = options;
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...rest }) };
}

export function paginated<T>(data: T[], total = data.length) {
  return { data, meta: { page: 1, pageSize: Math.max(data.length, 1), total, totalPages: 1 } };
}
