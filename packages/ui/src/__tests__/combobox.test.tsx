import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Combobox, type ComboboxItem } from '../components/combobox';

const ITEMS: ComboboxItem[] = [
  { value: 'a', label: 'Ada Lovelace', description: 'ada@example.com' },
  { value: 'b', label: 'Brian Kernighan' },
  { value: 'c', label: 'Carol Shaw', disabled: true },
];

describe('Combobox', () => {
  it('filters locally, selects with the mouse and reports the item', async () => {
    const onChange = vi.fn();
    render(
      <Combobox
        aria-label="Contact"
        items={ITEMS}
        value={null}
        onValueChange={onChange}
        placeholder="Pick a contact"
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Contact' });
    expect(trigger).toHaveTextContent('Pick a contact');
    await userEvent.click(trigger);
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'bri');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await userEvent.click(screen.getByRole('option', { name: /Brian/ }));
    expect(onChange).toHaveBeenCalledWith('b', ITEMS[1]);
  });

  it('supports keyboard navigation and skips disabled options', async () => {
    const onChange = vi.fn();
    render(<Combobox aria-label="Contact" items={ITEMS} value="a" onValueChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Contact' })).toHaveTextContent('Ada Lovelace');
    await userEvent.click(screen.getByRole('combobox', { name: 'Contact' }));
    const search = screen.getByPlaceholderText('Search…');
    // Starts on the selected item (Ada); ArrowDown → Brian; ArrowDown skips Carol → Ada.
    await userEvent.type(search, '{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('b', ITEMS[1]);
  });

  it('clears the selection and shows the empty message for unknown searches', async () => {
    const onChange = vi.fn();
    render(
      <Combobox
        aria-label="Contact"
        items={ITEMS}
        value="a"
        onValueChange={onChange}
        clearable
        emptyMessage="Nobody matches"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onChange).toHaveBeenCalledWith(null, null);
    await userEvent.click(screen.getByRole('combobox', { name: 'Contact' }));
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'zzz');
    expect(screen.getByText('Nobody matches')).toBeInTheDocument();
  });

  it('delegates searching to the parent when controlled', async () => {
    const onSearch = vi.fn();
    render(
      <Combobox
        aria-label="Contact"
        items={ITEMS}
        value={null}
        onValueChange={() => {}}
        search=""
        onSearchChange={onSearch}
        loading
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Contact' }));
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'x');
    expect(onSearch).toHaveBeenCalledWith('x');
    // Controlled mode never filters locally.
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
  });
});
