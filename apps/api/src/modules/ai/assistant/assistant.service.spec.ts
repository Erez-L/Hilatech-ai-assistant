import { ErrorCode } from '@hilatech/contracts';

import { assistantInstructions, buildAssistantAgent, runFailure } from './assistant.service';

describe('assistant helpers', () => {
  it('uses settings.ai instructions, name and tone, with a default otherwise', () => {
    const custom = assistantInstructions({
      name: 'Acme',
      settings: {
        ai: { assistantName: 'Ava', assistantInstructions: 'Be kind.', tone: 'concise' },
      },
    });
    expect(custom).toContain('You are Ava');
    expect(custom).toContain('"Acme"');
    expect(custom).toContain('Be kind.');
    expect(custom).toContain('concise');
    const fallback = assistantInstructions({ name: 'Acme', settings: {} });
    expect(fallback).toContain('business assistant');
    expect(fallback).toContain('CRM');
  });

  it('builds the implicit agent: synthetic id, write allowed, no delegation, bounded', () => {
    const agent = buildAssistantAgent(
      { id: 't1', organizationId: 'o1', providerConfigId: null, model: null },
      { name: 'Acme', settings: {} },
      { model: 'mock-chat' },
    );
    expect(agent).toMatchObject({
      id: 't1',
      name: 'Assistant',
      model: 'mock-chat',
      maxSteps: 8,
      maxDurationMs: 90_000,
      maxTokens: 200_000,
      permissions: { allowWrite: true, allowDelegation: false },
    });
    expect(agent.tools).toContain('crm.search_leads');
  });

  it('maps failed runs to API errors', () => {
    expect(runFailure({ status: 'timed_out', error: 'x' })).toMatchObject({
      code: ErrorCode.AI_LIMIT_EXCEEDED,
    });
    expect(
      runFailure({ status: 'failed', error: 'Execution limit exceeded: steps' }),
    ).toMatchObject({
      code: ErrorCode.AI_LIMIT_EXCEEDED,
    });
    expect(runFailure({ status: 'failed', error: 'boom' })).toMatchObject({
      code: ErrorCode.AI_PROVIDER_ERROR,
    });
  });
});
