import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MessageComposer } from '../message-composer';

describe('MessageComposer', () => {
  it('sends on Enter, keeps Shift+Enter as a newline and clears after success', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageComposer onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Reply' });

    await userEvent.type(box, 'First line{Shift>}{Enter}{/Shift}second line');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('First line\nsecond line');

    await userEvent.type(box, '{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith({ content: 'First line\nsecond line', role: 'agent' });
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('ignores empty drafts and keeps the draft when sending fails', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('nope'));
    render(<MessageComposer onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Reply' });
    await userEvent.type(box, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await userEvent.type(box, 'hello{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(box).toHaveValue('   hello');
  });

  it('is disabled while a send is in flight', () => {
    render(<MessageComposer onSend={vi.fn()} sending />);
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-busy', 'true');
  });

  it('logs a customer message when the role toggle is switched', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageComposer onSend={onSend} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Log customer message' }));
    const box = screen.getByRole('textbox', { name: 'Customer message' });
    await userEvent.type(box, 'Can you call me tomorrow?');
    await userEvent.click(screen.getByRole('button', { name: 'Log message' }));
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({
        content: 'Can you call me tomorrow?',
        role: 'customer',
      }),
    );
  });
});
