import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  SortableHead,
  Table,
  TableBody,
  TableEmptyRow,
  TableHeader,
  TableRow,
  sortRows,
} from '../components/table';

describe('SortableHead', () => {
  it('cycles sort direction and reports aria-sort', async () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead sortKey="name" sort={null} onSortChange={onSortChange}>
              Name
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmptyRow colSpan={1}>No rows</TableEmptyRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'asc' });

    rerender(
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              sortKey="name"
              sort={{ key: 'name', direction: 'asc' }}
              onSortChange={onSortChange}
            >
              Name
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmptyRow colSpan={1}>No rows</TableEmptyRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'desc' });
    expect(screen.getByText('No rows')).toBeInTheDocument();
  });
});

describe('sortRows', () => {
  const rows = [
    { name: 'Noa', age: 31 },
    { name: 'amir', age: 24 },
    { name: 'Dana', age: null },
  ];
  it('sorts strings case-insensitively and numbers numerically, nulls last', () => {
    expect(
      sortRows(rows, { key: 'name', direction: 'asc' }, (r, k) => r[k]).map((r) => r.name),
    ).toEqual(['amir', 'Dana', 'Noa']);
    expect(
      sortRows(rows, { key: 'age', direction: 'desc' }, (r, k) => r[k]).map((r) => r.name),
    ).toEqual(['Noa', 'amir', 'Dana']);
  });
});
