import {
  DEFAULT_AGENT_PERMISSIONS,
  DEFAULT_AGENT_RETRY_POLICY,
  parseAgentPermissions,
  parseAgentRetryPolicy,
  toAgentDefinition,
  type AgentRow,
} from './agent-definition.mapper';

const row: AgentRow = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  name: 'Lead qualifier',
  instructions: 'Qualify inbound leads.',
  providerConfigId: null,
  model: 'mock-chat',
  temperature: 0.2,
  maxOutputTokens: 512,
  tools: ['time.now', 'crm.search_leads'],
  permissions: { allowWrite: true, allowDelegation: true, delegateTo: [] },
  knowledgeBaseIds: [],
  maxSteps: 6,
  maxDurationMs: 60_000,
  maxTokens: 50_000,
  maxDelegations: 2,
  retryPolicy: { maxAttempts: 3, backoffMs: 500 },
  isEnabled: true,
};

describe('toAgentDefinition', () => {
  it('maps every column and parses the JSON columns with the contract schemas', () => {
    const def = toAgentDefinition(row);
    expect(def).toEqual({
      id: row.id,
      organizationId: row.organizationId,
      name: 'Lead qualifier',
      instructions: 'Qualify inbound leads.',
      providerConfigId: null,
      model: 'mock-chat',
      temperature: 0.2,
      maxOutputTokens: 512,
      tools: ['time.now', 'crm.search_leads'],
      permissions: { allowWrite: true, allowDelegation: true, delegateTo: [] },
      knowledgeBaseIds: [],
      maxSteps: 6,
      maxDurationMs: 60_000,
      maxTokens: 50_000,
      maxDelegations: 2,
      retryPolicy: { maxAttempts: 3, backoffMs: 500 },
      isEnabled: true,
    });
    // Arrays are copied, not shared with the row.
    expect(def.tools).not.toBe(row.tools);
  });

  it('applies contract defaults for an empty permissions object and retry policy', () => {
    const def = toAgentDefinition({ ...row, permissions: {}, retryPolicy: {} });
    expect(def.permissions).toEqual({ allowWrite: false, allowDelegation: false, delegateTo: [] });
    expect(def.retryPolicy).toEqual({ maxAttempts: 2, backoffMs: 2000 });
  });

  it('fills missing fields with defaults while keeping the valid ones', () => {
    expect(parseAgentPermissions({ allowWrite: true })).toEqual({
      allowWrite: true,
      allowDelegation: false,
      delegateTo: [],
    });
    expect(parseAgentRetryPolicy({ maxAttempts: 4 })).toEqual({ maxAttempts: 4, backoffMs: 2000 });
  });

  it('falls back to defaults when the JSON is not an object or has invalid values', () => {
    for (const bad of [null, 'nope', 42, ['x'], { allowWrite: 'yes' }]) {
      expect(parseAgentPermissions(bad)).toEqual(DEFAULT_AGENT_PERMISSIONS);
    }
    for (const bad of [null, 'nope', [], { maxAttempts: 0 }, { backoffMs: -1 }]) {
      expect(parseAgentRetryPolicy(bad)).toEqual(DEFAULT_AGENT_RETRY_POLICY);
    }
  });
});
