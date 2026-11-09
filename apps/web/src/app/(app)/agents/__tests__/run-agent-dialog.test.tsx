import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, seedSession } from '@/test/render';
import { mockApi } from '@/test/fetch';
import { RunAgentDialog, buildExecuteRequest } from '../run-agent-dialog';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push, prefetch: vi.fn() }),
}));

const AGENT = { id: '66666666-6666-4666-8666-666666666666', name: 'Triage' };

describe('buildExecuteRequest', () => {
  it('builds text and JSON payloads and rejects invalid input', () => {
    expect(buildExecuteRequest('text', '  do it  ', 'async')).toEqual({
      ok: true,
      body: { input: 'do it', mode: 'async' },
    });
    expect(buildExecuteRequest('json', '{"leadId":"x"}', 'sync')).toEqual({
      ok: true,
      body: { input: { leadId: 'x' }, mode: 'sync' },
    });
    expect(buildExecuteRequest('json', '[1]', 'sync').ok).toBe(false);
    expect(buildExecuteRequest('json', '{oops', 'sync')).toEqual({
      ok: false,
      error: 'This is not valid JSON',
    });
    expect(buildExecuteRequest('text', '   ', 'async').ok).toBe(false);
  });
});

describe('RunAgentDialog', () => {
  beforeEach(() => {
    seedSession(['agents:read', 'agents:execute']);
    push.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const reply = () =>
    new Response(JSON.stringify({ data: { id: 'exec-1', status: 'queued' } }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });

  it('posts text input in async mode by default and navigates to the execution', async () => {
    const { calls } = mockApi({ [`POST /agents/${AGENT.id}/execute`]: reply });
    renderWithProviders(<RunAgentDialog agent={AGENT} open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByRole('textbox', { name: /^Input/ }), 'Summarise new leads');
    await userEvent.click(screen.getByRole('button', { name: 'Run agent' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/agents/executions/exec-1'));
    expect(calls[0]!.body).toEqual({ input: 'Summarise new leads', mode: 'async' });
  });

  it('posts a parsed JSON object in sync mode and refuses invalid JSON', async () => {
    const { calls } = mockApi({ [`POST /agents/${AGENT.id}/execute`]: reply });
    renderWithProviders(<RunAgentDialog agent={AGENT} open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    await userEvent.click(screen.getByRole('radio', { name: /Wait for result/ }));
    const box = screen.getByRole('textbox', { name: /^Input/ });
    await userEvent.type(box, '{{"a": ');
    await userEvent.click(screen.getByRole('button', { name: 'Run agent' }));
    expect(await screen.findByText('This is not valid JSON')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await userEvent.clear(box);
    await userEvent.type(box, '{{"leadId": "abc"}');
    await userEvent.click(screen.getByRole('button', { name: 'Run agent' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calls[0]!.body).toEqual({ input: { leadId: 'abc' }, mode: 'sync' });
  });
});
