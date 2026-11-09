import { ErrorCode } from '@hilatech/contracts';

import { AgentRules } from './agent.rules';

describe('AgentRules', () => {
  it('cancels queued executions directly and requests cooperative cancel for running ones', () => {
    expect(AgentRules.cancelDecision('queued')).toBe('cancel_now');
    expect(AgentRules.cancelDecision('running')).toBe('request_cancel');
  });

  it.each(['succeeded', 'failed', 'timed_out', 'cancelled'] as const)(
    'refuses to cancel a %s execution with 409',
    (status) => {
      expect(() => AgentRules.cancelDecision(status)).toThrow(
        expect.objectContaining({ code: ErrorCode.CONFLICT }),
      );
      expect(AgentRules.isFinished(status)).toBe(true);
    },
  );

  it('lists unknown tools as a validation error and accepts none', () => {
    expect(() => AgentRules.assertKnownTools([])).not.toThrow();
    expect(() => AgentRules.assertKnownTools(['a.b', 'c.d'])).toThrow(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it('validates delegation targets (must exist, not self)', () => {
    expect(() => AgentRules.assertDelegationTargets(['a'], ['a'], 'z')).not.toThrow();
    expect(() => AgentRules.assertDelegationTargets(['a', 'b'], ['a'], null)).toThrow();
    expect(() => AgentRules.assertDelegationTargets(['z'], ['z'], 'z')).toThrow();
  });

  it('refuses disabled agents', () => {
    expect(() => AgentRules.assertExecutable({ isEnabled: false, name: 'x' })).toThrow(
      expect.objectContaining({ code: ErrorCode.CONFLICT }),
    );
  });
});
