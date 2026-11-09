import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CodeBlock } from '../components/code-block';
import { JsonViewer } from '../components/json-viewer';

describe('CodeBlock', () => {
  it('renders code as text, never as HTML', () => {
    const { container } = render(
      <CodeBlock code={'<img src=x onerror=alert(1)>'} language="html" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('html')).toBeInTheDocument();
  });

  it('copies the code to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CodeBlock code="npm test" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('npm test');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

describe('JsonViewer', () => {
  it('shows the empty label for null and empty containers', () => {
    const { rerender } = render(<JsonViewer value={null} emptyLabel="No output" />);
    expect(screen.getByText('No output')).toBeInTheDocument();
    rerender(<JsonViewer value={{}} emptyLabel="No output" />);
    expect(screen.getByText('No output')).toBeInTheDocument();
  });

  it('expands and collapses nested nodes', async () => {
    render(<JsonViewer value={{ a: 1, nested: { deep: 'x' } }} defaultExpandedDepth={1} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.queryByText('deep')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Expand nested' }));
    expect(screen.getByText('deep')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse nested' }));
    expect(screen.queryByText('deep')).toBeNull();
  });

  it('toggles a raw pretty-printed view', async () => {
    render(<JsonViewer value={{ ok: true }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
  });
});
