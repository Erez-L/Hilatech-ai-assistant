import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from '../components/segmented-control';
import { Timeline, TimelineItem } from '../components/timeline';
import { AutosizeTextarea } from '../components/input';
import { AreaChart } from '../charts/area-chart';
import { formatCurrency } from '../lib/format';

const OPTIONS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
] as const;

function Segmented({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = React.useState<string>('30d');
  return (
    <SegmentedControl
      aria-label="Period"
      options={OPTIONS}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a radiogroup with one tab stop and arrow-key navigation', async () => {
    const onChange = vi.fn();
    render(<Segmented onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Period' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '30 days' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '7 days' })).toHaveAttribute('tabindex', '-1');

    await userEvent.click(screen.getByRole('radio', { name: '7 days' }));
    expect(onChange).toHaveBeenLastCalledWith('7d');
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('30d');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('90d');
    expect(screen.getByRole('radio', { name: '90 days' })).toHaveFocus();
  });
});

describe('Timeline', () => {
  it('renders items with title, description and meta', () => {
    render(
      <Timeline aria-label="Activity">
        <TimelineItem title="Status changed" description="new → contacted" meta="2h ago" />
        <TimelineItem title="Note added" tone="accent" />
      </Timeline>,
    );
    expect(screen.getByRole('list', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('new → contacted')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });
});

describe('AutosizeTextarea', () => {
  it('renders a textarea that starts at minRows and forwards the ref', async () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<AutosizeTextarea ref={ref} aria-label="Message" minRows={2} maxRows={5} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    expect(textarea).toHaveAttribute('rows', '2');
    expect(ref.current).toBe(textarea);
    await userEvent.type(textarea, 'hello');
    expect(textarea).toHaveValue('hello');
  });
});

describe('AreaChart', () => {
  it('renders the frame with title and legend for multiple series', () => {
    render(
      <AreaChart
        title="New leads"
        description="Per day"
        data={[
          { date: '2026-01-01', leads: 1, conversations: 2 },
          { date: '2026-01-02', leads: 3, conversations: 1 },
        ]}
        xKey="date"
        series={[
          { key: 'leads', label: 'Leads' },
          { key: 'conversations', label: 'Conversations' },
        ]}
      />,
    );
    expect(screen.getByText('New leads')).toBeInTheDocument();
    expect(screen.getByText('Per day')).toBeInTheDocument();
    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(screen.getByText('Conversations')).toBeInTheDocument();
  });
});

describe('formatCurrency', () => {
  it('formats whole and fractional amounts, compacts large ones and tolerates bad codes', () => {
    expect(formatCurrency(1200, 'USD')).toBe('$1,200');
    expect(formatCurrency(1200.5, 'USD')).toBe('$1,200.50');
    expect(formatCurrency(1_250_000, 'USD', { compact: true })).toBe('$1.3M');
    expect(formatCurrency(Number.NaN, 'USD')).toBe('—');
    expect(formatCurrency(10, 'NOPE')).toBe('10 NOPE');
  });
});
