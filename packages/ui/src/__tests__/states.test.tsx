import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../components/empty-state';
import { ErrorState } from '../components/error-state';
import { StatusBadge } from '../components/badge';
import { Meter } from '../components/progress';

describe('EmptyState / ErrorState', () => {
  it('renders an empty state with an action', () => {
    render(<EmptyState title="No members yet" description="Invite your team." action={<button>Invite</button>} />);
    expect(screen.getByRole('heading', { name: 'No members yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('renders an error with retry', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Could not load" requestId="req_1" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
    expect(screen.getByText(/req_1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('StatusBadge', () => {
  it('humanises the status label', () => {
    render(<StatusBadge status="past_due" />);
    expect(screen.getByText('Past due')).toBeInTheDocument();
  });
});

describe('Meter', () => {
  it('exposes meter semantics', () => {
    render(<Meter label="Seats" value={3} max={5} />);
    const meter = screen.getByRole('meter', { name: 'Seats' });
    expect(meter).toHaveAttribute('aria-valuenow', '3');
    expect(meter).toHaveAttribute('aria-valuemax', '5');
  });
  it('handles unlimited', () => {
    render(<Meter label="Tokens" value={10} max={null} />);
    expect(screen.getByRole('meter', { name: 'Tokens' })).toHaveAttribute('aria-valuetext', '10 used, no limit');
  });
});
