import { type AgentExecutionStatus } from '@hilatech/contracts';

import { AppException } from '../../../common/errors/app.exception';

export const FINISHED_EXECUTION_STATUSES: readonly AgentExecutionStatus[] = [
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
];

export type CancelDecision = 'cancel_now' | 'request_cancel';

/** Pure rules around agents and executions (unit-tested without a database). */
export const AgentRules = {
  /**
   * `queued` executions are cancelled directly (the worker checks the status before starting);
   * `running` ones get a cooperative cancellation request; finished ones cannot be cancelled (409).
   */
  cancelDecision(status: AgentExecutionStatus): CancelDecision {
    if (status === 'queued') return 'cancel_now';
    if (status === 'running') return 'request_cancel';
    throw AppException.conflict(`Execution is already ${status.replace('_', ' ')}`, { status });
  },

  isFinished(status: AgentExecutionStatus): boolean {
    return FINISHED_EXECUTION_STATUSES.includes(status);
  },

  /** Unknown tool keys → 400 VALIDATION_ERROR listing them on `tools`. */
  assertKnownTools(unknown: readonly string[]): void {
    if (unknown.length === 0) return;
    throw AppException.validation(`Unknown tool(s): ${unknown.join(', ')}`, [
      {
        path: 'tools',
        message: `Unknown tool keys: ${unknown.join(', ')}`,
        code: 'custom',
        unknown,
      },
    ]);
  },

  /** `permissions.delegateTo` must reference agents of the organization (and not the agent itself). */
  assertDelegationTargets(
    requested: readonly string[],
    found: readonly string[],
    selfId: string | null,
  ): void {
    const missing = requested.filter((id) => !found.includes(id) || id === selfId);
    if (missing.length === 0) return;
    throw AppException.validation('Delegation targets must be other agents of this organization', [
      {
        path: 'permissions.delegateTo',
        message: `Unknown or invalid agent id(s): ${missing.join(', ')}`,
        code: 'custom',
      },
    ]);
  },

  assertExecutable(agent: { isEnabled: boolean; name: string }): void {
    if (!agent.isEnabled) {
      throw AppException.conflict(`Agent "${agent.name}" is disabled`, { isEnabled: false });
    }
  },
};
