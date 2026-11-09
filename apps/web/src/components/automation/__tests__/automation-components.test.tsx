import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@hilatech/contracts';
import { renderWithProviders, seedSession } from '@/test/render';
import { mockApi } from '@/test/fetch';
import { StepFlow } from '../step-flow';
import { SecretDialog } from '../secret-dialog';
import { WorkflowEditor } from '../workflow-editor';
import { parseRunInput } from '../run-workflow-dialog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

const WF: Workflow = {
  id: '33333333-3333-4333-8333-333333333333',
  organizationId: 'o',
  name: 'Demo',
  description: null,
  isEnabled: false,
  trigger: { type: 'manual' },
  steps: [
    { id: 'a', type: 'set_variable', name: 'x', value: '1' },
    {
      id: 'b',
      type: 'condition',
      left: '{{ vars.x }}',
      operator: 'eq',
      right: '1',
      then: ['c'],
      else: [],
    },
    { id: 'c', type: 'delay', seconds: 5 },
  ],
  runCount: 0,
  lastRunAt: null,
  createdById: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('StepFlow', () => {
  it('renders trigger, ordered steps and condition branches', () => {
    renderWithProviders(
      <StepFlow
        trigger={{ type: 'manual' }}
        steps={WF.steps.map((step) => ({ key: step.id, step }))}
      />,
    );
    const items = within(screen.getByRole('list', { name: 'Workflow flow' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(4);
    expect(screen.getByText('then: c')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go to step 3: Wait \(c\)/ })).toBeInTheDocument();
  });
});

describe('SecretDialog', () => {
  it('shows the secret with a copy button and warns it is shown once', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onClose = vi.fn();
    renderWithProviders(<SecretDialog title="Created" secret="whsec_123" onClose={onClose} />);
    expect(screen.getByLabelText('Signing secret')).toHaveValue('whsec_123');
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy secret' }));
    expect(writeText).toHaveBeenCalledWith('whsec_123');
    await userEvent.click(screen.getByRole('button', { name: /I’ve saved the secret/ }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('parseRunInput', () => {
  it('accepts objects and rejects other JSON', () => {
    expect(parseRunInput('')).toEqual({ ok: true, input: {} });
    expect(parseRunInput('{"a":1}')).toEqual({ ok: true, input: { a: 1 } });
    expect(parseRunInput('[1]').ok).toBe(false);
    expect(parseRunInput('{').ok).toBe(false);
  });
});

describe('WorkflowEditor', () => {
  beforeEach(() => seedSession(['automations:read', 'automations:manage']));

  it('validates against the API and highlights issues by step id', async () => {
    const { calls } = mockApi({
      'POST /workflows/validate': () => ({
        valid: false,
        issues: [{ stepId: 'b', path: 'steps[1].then[0]', message: 'Unknown step id "zz"' }],
      }),
    });
    renderWithProviders(<WorkflowEditor workflow={WF} />);
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
    const list = await screen.findByRole('list', { name: 'Validation issues' });
    expect(list).toHaveTextContent('Unknown step id "zz"');
    expect(calls[0]!.body).toMatchObject({ trigger: { type: 'manual' } });
    expect((calls[0]!.body as { steps: unknown[] }).steps).toHaveLength(3);
    // The flow node of step b is flagged with a problem count.
    expect(
      screen.getByRole('button', { name: /Go to step 2: Condition \(b\), 1 problem/ }),
    ).toBeInTheDocument();
  });

  it('reorders and removes steps with accessible controls', async () => {
    renderWithProviders(<WorkflowEditor workflow={WF} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move step a down' }));
    const flow = screen.getByRole('list', { name: 'Workflow flow' });
    expect(within(flow).getAllByRole('button')[0]).toHaveAccessibleName(/step 1: Condition \(b\)/);
    await userEvent.click(screen.getByRole('button', { name: 'Remove step c' }));
    expect(within(flow).getAllByRole('button')).toHaveLength(2);
  });

  it('blocks save on invalid JSON payload without calling the API', async () => {
    const wf: Workflow = {
      ...WF,
      steps: [{ id: 'n', type: 'outbound_webhook', event: 'x.y', payload: {} }],
    };
    const { calls } = mockApi({});
    renderWithProviders(<WorkflowEditor workflow={wf} />);
    const box = screen.getByRole('textbox', { name: /Payload/ });
    await userEvent.clear(box);
    await userEvent.type(box, '{{oops');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getAllByText(/valid JSON object/).length).toBeGreaterThan(0));
    expect(calls).toHaveLength(0);
  });

  it('is read-only without automations:manage', () => {
    seedSession(['automations:read']);
    renderWithProviders(<WorkflowEditor workflow={WF} />);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enable workflow' })).toBeNull();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled();
  });
});
