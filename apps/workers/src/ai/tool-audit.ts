import { AuditAction } from '@hilatech/contracts';
import type { Prisma, PrismaClient } from '@hilatech/database';
import type { RunnerDeps } from '@hilatech/ai-engine';
import type { PinoLogger } from 'nestjs-pino';

export type ToolOutcomeParams = Parameters<NonNullable<RunnerDeps['onToolOutcome']>>[0];

/** The Prisma surface the audit writer uses (so unit tests can pass a mock). */
export type AuditWriter = Pick<PrismaClient, 'auditLog'>;

/** Audit row shape for one tool outcome — exported so the mapping is unit-testable. */
export function toolOutcomeAuditData(
  params: ToolOutcomeParams,
): Prisma.AuditLogUncheckedCreateInput {
  const { outcome } = params;
  const denied = outcome.status === 'denied' || outcome.status === 'requires_authorization';
  const metadata: Prisma.InputJsonObject = {
    executionId: params.executionId,
    toolKey: params.toolKey,
    status: outcome.status,
    reason:
      outcome.status === 'denied'
        ? outcome.reason
        : outcome.status === 'requires_authorization'
          ? 'requires_authorization'
          : outcome.status === 'error'
            ? (outcome.result.error ?? 'error')
            : null,
    durationMs: outcome.durationMs,
  };
  return {
    action: denied ? AuditAction.AI_TOOL_DENIED : AuditAction.AI_TOOL_EXECUTED,
    organizationId: params.organizationId,
    actorUserId: params.userId,
    targetType: 'agent',
    targetId: params.agentId,
    metadata,
  };
}

/**
 * The workers have no `AuditService`; tool outcomes are written straight to `AuditLog`. Failures are
 * logged, never thrown — the executor's hook contract is "must not throw" and an audit hiccup must
 * not fail the execution.
 */
export function createToolAuditHook(
  prisma: AuditWriter,
  logger: PinoLogger,
): NonNullable<RunnerDeps['onToolOutcome']> {
  return async (params) => {
    try {
      await prisma.auditLog.create({ data: toolOutcomeAuditData(params) });
    } catch (err) {
      logger.error(
        { err, executionId: params.executionId, toolKey: params.toolKey },
        'Failed to write tool audit log',
      );
    }
  };
}
