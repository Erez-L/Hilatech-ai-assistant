import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeadStatusPipeline } from '../lead-status-pipeline';

describe('LeadStatusPipeline', () => {
  it('marks the current stage and moves forwards or back on click', async () => {
    const onChange = vi.fn();
    render(<LeadStatusPipeline status="contacted" onChange={onChange} />);
    const list = screen.getByRole('list', { name: 'Pipeline stage' });
    expect(list).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contacted' })).toHaveAttribute(
      'aria-current',
      'step',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Qualified' }));
    expect(onChange).toHaveBeenLastCalledWith('qualified');
    await userEvent.click(screen.getByRole('button', { name: /New/ }));
    expect(onChange).toHaveBeenLastCalledWith('new');
    // Clicking the current stage is a no-op.
    await userEvent.click(screen.getByRole('button', { name: 'Contacted' }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('marks won immediately but asks for a reason before marking lost', async () => {
    const onChange = vi.fn();
    render(<LeadStatusPipeline status="proposal" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mark won' }));
    expect(onChange).toHaveBeenLastCalledWith('won');

    await userEvent.click(screen.getByRole('button', { name: 'Mark lost' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(screen.getByLabelText(/Reason/), 'Budget cut');
    await userEvent.click(screen.getByRole('button', { name: 'Mark as lost' }));
    expect(onChange).toHaveBeenLastCalledWith('lost', 'Budget cut');
    expect(dialog).not.toBeInTheDocument();
  });

  it('disables every control while a change is pending', () => {
    render(<LeadStatusPipeline status="new" onChange={vi.fn()} pending />);
    for (const name of ['New', 'Contacted', 'Qualified', 'Proposal', 'Mark won', 'Mark lost']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}$`) })).toBeDisabled();
    }
  });
});
