import { type Agent, type AgentExecution } from '@hilatech/database';

import {
  parseAgentPermissions,
  parseRetryPolicy,
  toAgent,
  toAgentDefinition,
  toAgentExecution,
} from './agents.mappers';

const now = new Date('2026-11-09T10:00:00Z');

function agentRow(overrides: Partial<Agent> = {}): Agent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    name: 'Researcher',
    description: null,
    instructions: 'Research things.',
    providerConfigId: null,
    model: 'mock-chat',
    temperature: 0.2,
    maxOutputTokens: 1024,
    tools: ['time.now'],
    permissions: { allowWrite: true, allowDelegation: true, delegateTo: [] },
    knowledgeBaseIds: [],
    maxSteps: 12,
    maxDurationMs: 120_000,
    maxTokens: 150_000,
    maxDelegations: 3,
    retryPolicy: { maxAttempts: 3, backoffMs: 500 },
    isEnabled: true,
    createdById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('agent mappers', () => {
  it('maps a row to the engine AgentDefinition with validated JSON columns', () => {
    const definition = toAgentDefinition(agentRow());
    expect(definition).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      name: 'Researcher',
      instructions: 'Research things.',
      providerConfigId: null,
      model: 'mock-chat',
      temperature: 0.2,
      maxOutputTokens: 1024,
      tools: ['time.now'],
      permissions: { allowWrite: true, allowDelegation: true, delegateTo: [] },
      knowledgeBaseIds: [],
      maxSteps: 12,
      maxDurationMs: 120_000,
      maxTokens: 150_000,
      maxDelegations: 3,
      retryPolicy: { maxAttempts: 3, backoffMs: 500 },
      isEnabled: true,
    });
  });

  it('falls back to safe defaults when stored permissions / retry policy are malformed', () => {
    expect(parseAgentPermissions(null)).toEqual({
      allowWrite: false,
      allowDelegation: false,
      delegateTo: [],
    });
    expect(parseAgentPermissions({ allowWrite: 'yes' })).toEqual({
      allowWrite: false,
      allowDelegation: false,
      delegateTo: [],
    });
    expect(parseAgentPermissions({ allowWrite: true })).toEqual({
      allowWrite: true,
      allowDelegation: false,
      delegateTo: [],
    });
    expect(parseRetryPolicy('garbage')).toEqual({ maxAttempts: 2, backoffMs: 2000 });
    expect(parseRetryPolicy({ maxAttempts: 99 })).toEqual({ maxAttempts: 2, backoffMs: 2000 });
    const definition = toAgentDefinition(agentRow({ permissions: [], retryPolicy: 7 }));
    expect(definition.permissions.allowWrite).toBe(false);
    expect(definition.retryPolicy.maxAttempts).toBe(2);
  });

  it('maps the API DTO with the creator summary and ISO timestamps', () => {
    const dto = toAgent({
      ...agentRow({ createdById: 'u1' }),
      createdBy: { id: 'u1', email: 'a@b.c', firstName: 'A', lastName: 'B', avatarUrl: null },
    });
    expect(dto.createdBy).toEqual({
      id: 'u1',
      email: 'a@b.c',
      firstName: 'A',
      lastName: 'B',
      avatarUrl: null,
    });
    expect(dto.createdAt).toBe('2026-11-09T10:00:00.000Z');
    expect(dto.tools).toEqual(['time.now']);
  });

  it('converts execution decimals and nullable dates', () => {
    const row = {
      id: 'e1',
      organizationId: 'o1',
      agentId: 'a1',
      parentExecutionId: null,
      rootExecutionId: 'e1',
      triggeredByUserId: null,
      trigger: 'manual',
      status: 'succeeded',
      input: 'task',
      output: { text: 'done' },
      error: null,
      depth: 0,
      stepCount: 2,
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostUsd: { toNumber: () => 0.0012 },
      startedAt: now,
      finishedAt: null,
      durationMs: 42,
      createdAt: now,
      updatedAt: now,
    } as unknown as AgentExecution;
    const dto = toAgentExecution({ ...row, agent: { id: 'a1', name: 'Researcher' } });
    expect(dto).toMatchObject({
      estimatedCostUsd: 0.0012,
      startedAt: '2026-11-09T10:00:00.000Z',
      finishedAt: null,
      agent: { id: 'a1', name: 'Researcher' },
      output: { text: 'done' },
    });
  });
});
