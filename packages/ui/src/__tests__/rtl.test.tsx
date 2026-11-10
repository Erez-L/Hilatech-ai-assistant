import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Input, Textarea } from '../components/input';
import { SegmentedControl } from '../components/segmented-control';

const OPTIONS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
] as const;

function Segmented({ dir }: { dir: 'ltr' | 'rtl' }) {
  const [value, setValue] = React.useState<string>('b');
  return (
    <div dir={dir}>
      <SegmentedControl
        aria-label="Pick"
        options={OPTIONS}
        value={value}
        onValueChange={setValue}
      />
      <output data-testid="value">{value}</output>
    </div>
  );
}

describe('RTL behaviour', () => {
  it('inputs: free text is dir=auto, identifiers are LTR and end-aligned in RTL pages', () => {
    render(
      <>
        <Input aria-label="name" />
        <Input aria-label="email" type="email" />
        <Input aria-label="override" type="email" dir="rtl" />
        <Textarea aria-label="notes" />
      </>,
    );
    expect(screen.getByLabelText('name')).toHaveAttribute('dir', 'auto');
    expect(screen.getByLabelText('email')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('email').className).toContain('rtl:text-end');
    expect(screen.getByLabelText('override')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByLabelText('notes')).toHaveAttribute('dir', 'auto');
  });

  it('segmented control: ArrowRight advances in LTR, ArrowLeft advances in RTL', async () => {
    const user = userEvent.setup();
    const ltr = render(<Segmented dir="ltr" />);
    await user.click(screen.getByRole('radio', { name: 'B' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('value')).toHaveTextContent('c');
    ltr.unmount();

    render(<Segmented dir="rtl" />);
    await user.click(screen.getByRole('radio', { name: 'B' }));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('value')).toHaveTextContent('c');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('value')).toHaveTextContent('b');
  });
});
