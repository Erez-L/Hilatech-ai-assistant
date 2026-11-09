import type { PinoLogger } from 'nestjs-pino';
import { createToolAuditHook, toolOutcomeAuditData, type AuditWriter } from './tool-audit';

const base = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  agentId: '11111111-1111-4111-8111-111111111111',
  executionId: '44444444-4444-4444-8444-444444444444',
};

const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() } as unknown as PinoLogger;

describe('toolOutcomeAuditData', () => {
  it('records executed tools as ai.tool_executed targeting the agent', () => {
    const data = toolOutcomeAuditData({
      ...base,
      toolKey: 'time.now',
      outcome: {
        status: 'ok',
        toolKey: 'time.now',
        durationMs: 3,
        result: { ok: true, summary: 'Now is …' },
      },
    });
    expect(data).toEqual({
      action: 'ai.tool_executed',
      organizationId: base.organizationId,
      actorUserId: base.userId,
      targetType: 'agent',
      targetId: base.agentId,
      metadata: {
        executionId: base.executionId,
        toolKey: 'time.now',
        status: 'ok',
        reason: null,
        durationMs: 3,
      },
    });
  });

  it('records denied tools and authorization requests as ai.tool_denied with the reason', () => {
    const denied = toolOutcomeAuditData({
      ...base,
      userId: null,
      toolKey: 'crm.create_lead',
      outcome: {
        status: 'denied',
        toolKey: 'crm.create_lead',
        reason: 'missing_permission',
        durationMs: 0,
        result: { ok: false, summary: 'Missing permission', error: 'missing_permission' },
      },
    });
    expect(denied.action).toBe('ai.tool_denied');
    expect(denied.actorUserId).toBeNull();
    expect(denied.metadata).toMatchObject({ status: 'denied', reason: 'missing_permission' });

    const dangerous = toolOutcomeAuditData({
      ...base,
      toolKey: 'crm.delete_contact',
      outcome: {
        status: 'requires_authorization',
        toolKey: 'crm.delete_contact',
        durationMs: 0,
        result: { ok: false, summary: 'needs a human', error: 'requires_authorization' },
      },
    });
    expect(dangerous.action).toBe('ai.tool_denied');
    expect(dangerous.metadata).toMatchObject({ reason: 'requires_authorization' });
  });

  it('records a failed execution as executed (the tool ran) with the error as reason', () => {
    const data = toolOutcomeAuditData({
      ...base,
      toolKey: 'crm.search_leads',
      outcome: {
        status: 'error',
        toolKey: 'crm.search_leads',
        durationMs: 12,
        result: { ok: false, summary: 'failed', error: 'boom' },
      },
    });
    expect(data.action).toBe('ai.tool_executed');
    expect(data.metadata).toMatchObject({ status: 'error', reason: 'boom' });
  });
});

describe('createToolAuditHook', () => {
  it('writes one AuditLog row and never throws when the write fails', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const hook = createToolAuditHook(
      { auditLog: { create } } as unknown as AuditWriter,
      logger,
    );
    await expect(
      hook({
        ...base,
        toolKey: 'time.now',
        outcome: { status: 'ok', toolKey: 'time.now', durationMs: 1, result: { ok: true, summary: '' } },
      }),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });
});
