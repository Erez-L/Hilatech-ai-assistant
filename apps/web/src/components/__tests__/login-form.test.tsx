import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResponse } from '@hilatech/contracts';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/stores/session';

const replace = vi.fn();
let search = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => search,
  usePathname: () => '/login',
}));

const login = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  authApi: { login: (...args: unknown[]) => login(...args) },
}));

import { LoginForm } from '@/app/(auth)/login/login-form';

const AUTH: AuthResponse = {
  accessToken: 'tok',
  expiresIn: 900,
  tokenType: 'Bearer',
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'noa@example.com',
    firstName: 'Noa',
    lastName: 'Levi',
    avatarUrl: null,
    emailVerifiedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  organizations: [
    { id: 'org-a', name: 'A', slug: 'a', logoUrl: null, roleKey: 'owner', roleName: 'Owner' },
  ],
};

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search = new URLSearchParams();
    useSession.getState().clear();
  });

  it('validates with the contract schema before calling the API', async () => {
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/Email/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in, stores the session and redirects to the safe next path', async () => {
    search = new URLSearchParams('next=/team');
    login.mockResolvedValueOnce(AUTH);
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/Email/), 'Noa@Example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'Secret-Passw0rd');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/team'));
    expect(login).toHaveBeenCalledWith({ email: 'noa@example.com', password: 'Secret-Passw0rd' });
    expect(useSession.getState().accessToken).toBe('tok');
    expect(useSession.getState().activeOrganizationId).toBe('org-a');
  });

  it('sends users without an organization to onboarding and ignores unsafe next URLs', async () => {
    search = new URLSearchParams('next=https://evil.example');
    login.mockResolvedValueOnce({ ...AUTH, organizations: [] });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/Email/), 'noa@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'Secret-Passw0rd');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/onboarding'));
  });

  it('maps server validation errors to fields and shows credential errors inline', async () => {
    login.mockRejectedValueOnce(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid',
        details: [{ path: ['email'], message: 'Email domain not allowed' }],
      }),
    );
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/Email/), 'noa@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'Secret-Passw0rd');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email domain not allowed')).toBeInTheDocument();

    login.mockRejectedValueOnce(
      new ApiError({ status: 401, code: 'INVALID_CREDENTIALS', message: 'nope' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/don’t match/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
