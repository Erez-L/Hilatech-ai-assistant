import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from '../components/filter-bar';
import { FormSection } from '../components/form-section';

const labels = { filters: 'Filters', clear: 'Clear' };

describe('FilterBar', () => {
  it('keeps the search visible and reveals the other filters from the Filters button', async () => {
    render(
      <FilterBar search={<input aria-label="Search" />} activeCount={2} labels={labels}>
        <select aria-label="Stage" />
      </FilterBar>,
    );
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Filters/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('2');
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(panel.className).toContain('hidden');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel.className).not.toMatch(/(^| )hidden( |$)/);
  });

  it('shows no count when no filter is set, and no Filters button without filters', () => {
    const { rerender } = render(
      <FilterBar search={<input aria-label="Search" />} labels={labels}>
        <select aria-label="Stage" />
      </FilterBar>,
    );
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    rerender(<FilterBar search={<input aria-label="Search" />} labels={labels} />);
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
  });

  it('clears through the callback and disables Clear when there is nothing to clear', async () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <FilterBar labels={labels} onClear={onClear} canClear>
        <select aria-label="Stage" />
      </FilterBar>,
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]!);
    expect(onClear).toHaveBeenCalledTimes(1);
    rerender(
      <FilterBar labels={labels} onClear={onClear} canClear={false}>
        <select aria-label="Stage" />
      </FilterBar>,
    );
    for (const button of screen.getAllByRole('button', { name: 'Clear' }))
      expect(button).toBeDisabled();
  });
});

describe('FormSection', () => {
  it('names the section by its heading', () => {
    render(
      <FormSection title="Profile" description="Public details">
        <input aria-label="Name" />
      </FormSection>,
    );
    expect(screen.getByRole('region', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByText('Public details')).toBeInTheDocument();
  });
});
