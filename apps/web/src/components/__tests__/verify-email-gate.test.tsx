import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, seedSession, TEST_USER } from '@/test/render';
import { useSession } from '@/stores/session';

const resendVerification = vi.fn();
const me = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  authApi: {
    resendVerification: (...args: unknown[]) => resendVerification(...args),
    me: (...args: unknown[]) => me(...args),
    logout: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ApiError } from '@/lib/api';
import { VerifyEmailGate } from '@/components/auth/verify-email-gate';

describe('VerifyEmailGate', () => {
  beforeEach(() => {
    resendVerification.mockReset();
    me.mockReset();
    seedSession([]);
    useSession.setState({ emailVerificationRequired: true });
  });

  it('names the address and resends the email', async () => {
    resendVerification.mockResolvedValue(undefined);
    renderWithProviders(<VerifyEmailGate />);
    expect(screen.getByText(new RegExp(TEST_USER.email))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    expect(
      await screen.findByText('Verification email sent. Check your inbox.'),
    ).toBeInTheDocument();
    expect(resendVerification).toHaveBeenCalledTimes(1);
  });

  it('explains the cooldown when the API answers RATE_LIMITED', async () => {
    resendVerification.mockRejectedValue(
      new ApiError({ status: 429, code: 'RATE_LIMITED', message: 'Too many requests' }),
    );
    renderWithProviders(<VerifyEmailGate />);
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    expect(await screen.findByText(/An email was sent a moment ago/)).toBeInTheDocument();
  });

  it('re-check keeps the gate while unverified and lifts it once the address is verified', async () => {
    me.mockResolvedValueOnce({ user: { ...TEST_USER, emailVerifiedAt: null } });
    renderWithProviders(<VerifyEmailGate />);
    await userEvent.click(screen.getByRole('button', { name: 'I’ve verified my email' }));
    expect(await screen.findByText(/not verified yet/)).toBeInTheDocument();
    expect(useSession.getState().emailVerificationRequired).toBe(true);

    me.mockResolvedValueOnce({
      user: { ...TEST_USER, emailVerifiedAt: '2026-11-12T00:00:00.000Z' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'I’ve verified my email' }));
    await waitFor(() => expect(useSession.getState().emailVerificationRequired).toBe(false));
    expect(useSession.getState().user?.emailVerifiedAt).toBe('2026-11-12T00:00:00.000Z');
  });
});
