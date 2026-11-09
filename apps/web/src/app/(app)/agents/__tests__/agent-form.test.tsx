import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_HARD_LIMITS, type ToolDefinition } from '@hilatech/contracts';
import { paginated, renderWithProviders, seedSession } from '@/test/render';
import { mockApi } from '@/test/fetch';
import { ToolsPicker } from '@/components/ai/tools-picker';
import { agentFormDefaults, agentFormSchema, toAgentRequest } from '../agent-form';
import { AgentEditor } from '../agent-editor';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/agents/new',
  useSearchParams: () => new URLSearchParams(),
}));

const TOOLS: ToolDefinition[] = [
  {
    key: 'time.now',
    name: 'Current time',
    description: 'Returns the current time.',
    category: 'utility',
    riskLevel: 'read',
    requiredPermission: null,
    inputSchema: {},
  },
  {
    key: 'leads.update_status',
    name: 'Update lead status',
    description: 'Moves a lead.',
    category: 'crm',
    riskLevel: 'write',
    requiredPermission: 'leads:update',
    inputSchema: {},
  },
  {
    key: 'leads.delete',
    name: 'Delete lead',
    description: 'Deletes a lead.',
    category: 'crm',
    riskLevel: 'dangerous',
    requiredPermission: 'leads:delete',
    inputSchema: {},
  },
];

function formInput(over: Record<string, unknown> = {}) {
  return { ...agentFormDefaults(null), name: 'Triage', instructions: 'Be helpful', ...over };
}

describe('agentFormSchema', () => {
  it('rejects limits above the platform hard limits', () => {
    for (const [field, value] of [
      ['maxSteps', String(AGENT_HARD_LIMITS.maxSteps + 1)],
      ['maxDurationSec', String(AGENT_HARD_LIMITS.maxDurationMs / 1000 + 1)],
      ['maxTokens', String(AGENT_HARD_LIMITS.maxTokens + 1)],
      ['maxDelegations', String(AGENT_HARD_LIMITS.maxDelegationsPerExecution + 1)],
    ] as const) {
      const result = agentFormSchema.safeParse(formInput({ [field]: value }));
      expect(result.success, field).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual([field]);
    }
    expect(agentFormSchema.safeParse(formInput()).success).toBe(true);
  });

  it('converts seconds to ms and omits empty optional fields in the request', () => {
    const values = agentFormSchema.parse(
      formInput({
        maxDurationSec: '90',
        temperature: '',
        tools: ['time.now'],
        allowDelegation: false,
        delegateTo: ['x'],
      }),
    );
    const body = toAgentRequest(values);
    expect(body.maxDurationMs).toBe(90_000);
    expect(body.temperature).toBeUndefined();
    expect(body.providerConfigId).toBeUndefined();
    expect(body.tools).toEqual(['time.now']);
    expect(body.permissions.delegateTo).toEqual([]);
    expect(body.retryPolicy).toEqual({ maxAttempts: 2, backoffMs: 2000 });
  });
});

describe('ToolsPicker', () => {
  it('groups by category, shows risk badges, warns on dangerous tools and toggles selection', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ToolsPicker
        tools={TOOLS}
        value={['leads.update_status']}
        onChange={onChange}
        allowWrite={false}
      />,
    );
    expect(screen.getByText('Crm')).toBeInTheDocument();
    expect(screen.getByText('Utility')).toBeInTheDocument();
    expect(screen.getByText('Dangerous')).toBeInTheDocument();
    expect(screen.getByText(/never runs without authorization/i)).toBeInTheDocument();
    expect(screen.getByText(/Needs “Allow write actions”/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /Current time/ }));
    expect(onChange).toHaveBeenCalledWith(['leads.update_status', 'time.now']);
    await userEvent.click(screen.getByRole('checkbox', { name: /Update lead status/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('AgentEditor (new)', () => {
  beforeEach(() => seedSession(['agents:read', 'agents:manage', 'ai:config:read']));
  afterEach(() => vi.unstubAllGlobals());

  function stub() {
    return mockApi({
      'GET /ai/tools': () => TOOLS,
      'GET /ai/providers': () => [],
      'GET /ai/models': () => [],
      'GET /agents': () => paginated([]),
      'POST /agents': (c) =>
        new Response(
          JSON.stringify({
            data: {
              id: '55555555-5555-4555-8555-555555555555',
              name: (c.body as { name: string }).name,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
    });
  }

  it('blocks a max-steps value above the hard limit and sends nothing', async () => {
    const { calls } = stub();
    renderWithProviders(<AgentEditor />);
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Triage');
    await userEvent.type(screen.getByLabelText(/^Instructions/), 'Be helpful');
    const steps = screen.getByLabelText('Max steps');
    await userEvent.clear(steps);
    await userEvent.type(steps, String(AGENT_HARD_LIMITS.maxSteps + 1));
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    expect(await screen.findByText(/Max steps must be between 1 and 50/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('creates an agent with the picked tool and limits in contract shape', async () => {
    const { calls } = stub();
    renderWithProviders(<AgentEditor />);
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Triage');
    await userEvent.type(screen.getByLabelText(/^Instructions/), 'Be helpful');
    const picker = await screen.findByRole('checkbox', { name: /Current time/ });
    await userEvent.click(picker);
    const secs = screen.getByLabelText('Max duration (seconds)');
    await userEvent.clear(secs);
    await userEvent.type(secs, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/agents')).toBe(true),
    );
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Triage',
      instructions: 'Be helpful',
      tools: ['time.now'],
      maxDurationMs: 30_000,
      maxSteps: 12,
      permissions: { allowWrite: false, allowDelegation: false, delegateTo: [] },
      isEnabled: true,
    });
    expect(within(document.body).queryByText(/must be between/)).toBeNull();
  });
});
