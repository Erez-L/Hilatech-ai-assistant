import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from '../components/button';

describe('Button', () => {
  it('renders children and handles clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save changes</Button>);
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and busy while loading', () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('renders as the child element with asChild', () => {
    render(
      <Button asChild>
        <a href="/login">Sign in</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/login');
  });
});

describe('IconButton', () => {
  it('exposes an accessible name', () => {
    render(
      <IconButton label="Close">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
