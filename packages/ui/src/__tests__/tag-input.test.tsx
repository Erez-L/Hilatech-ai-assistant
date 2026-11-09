import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TagInput } from '../components/tag-input';

function Harness({
  initial = [] as string[],
  onChange = vi.fn(),
  maxTags = undefined as number | undefined,
}) {
  const [tags, setTags] = React.useState<string[]>(initial);
  return (
    <TagInput
      aria-label="Tags"
      value={tags}
      maxTags={maxTags}
      onValueChange={(next) => {
        setTags(next);
        onChange(next);
      }}
    />
  );
}

describe('TagInput', () => {
  it('commits on Enter and comma, ignoring duplicates and blanks', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Tags' });
    await userEvent.type(input, 'vip{Enter}');
    await userEvent.type(input, ' VIP {Enter}');
    await userEvent.type(input, 'retail,');
    await userEvent.type(input, '   {Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['vip', 'retail']);
    expect(screen.getByRole('button', { name: 'Remove vip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove retail' })).toBeInTheDocument();
  });

  it('removes with Backspace on an empty field and via the chip button', async () => {
    const onChange = vi.fn();
    render(<Harness initial={['one', 'two']} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Tags' });
    await userEvent.type(input, '{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith(['one']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove one' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('respects maxTags', async () => {
    const onChange = vi.fn();
    render(<Harness initial={['a']} maxTags={1} onChange={onChange} />);
    expect(screen.getByRole('textbox', { name: 'Tags' })).toBeDisabled();
  });
});
