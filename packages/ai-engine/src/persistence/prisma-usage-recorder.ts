import type { Prisma, PrismaClient } from '@hilatech/database';
import { monthPeriod } from '@hilatech/shared';

import type { UsageEntry, UsageRecorder } from '../orchestrator/types';
import type { EngineLogger } from '../tools/types';
import { noopLogger } from '../tools/types';
import { PricingTable } from '../usage/pricing';

export interface PrismaUsageRecorderOptions {
  pricing?: PricingTable;
  logger?: EngineLogger;
  now?: () => Date;
}

/**
 * Writes one `AiRequestLog` per provider call and one `UsageRecord(ai_tokens)` row so the billing
 * entitlements (summed per month) see AI consumption immediately. Cost is estimated only when the
 * pricing table knows the model.
 */
export class PrismaUsageRecorder implements UsageRecorder {
  private readonly pricing: PricingTable;
  private readonly logger: EngineLogger;
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    options: PrismaUsageRecorderOptions = {},
  ) {
    this.pricing = options.pricing ?? new PricingTable();
    this.logger = options.logger ?? noopLogger;
    this.now = options.now ?? (() => new Date());
  }

  async record(entry: UsageEntry): Promise<{ estimatedCostUsd: number | null }> {
    const estimatedCostUsd =
      entry.status === 'success'
        ? this.pricing.estimate(entry.provider, entry.model, entry.usage)
        : null;
    const totalTokens = entry.usage.inputTokens + entry.usage.outputTokens;
    const now = this.now();
    const { start, end } = monthPeriod(now);
    try {
      await this.prisma.$transaction([
        this.prisma.aiRequestLog.create({
          data: {
            organizationId: entry.organizationId,
            userId: entry.userId,
            agentId: entry.agentId,
            executionId: entry.executionId,
            threadId: entry.threadId,
            provider: entry.provider,
            model: entry.model,
            operation: entry.operation,
            status: entry.status,
            inputTokens: entry.usage.inputTokens,
            outputTokens: entry.usage.outputTokens,
            durationMs: entry.durationMs,
            estimatedCostUsd,
            errorCode: entry.errorCode ?? null,
            errorMessage: entry.errorMessage ? entry.errorMessage.slice(0, 2000) : null,
            metadata: (entry.metadata ?? {}) as Prisma.InputJsonObject,
          },
        }),
        ...(totalTokens > 0
          ? [
              this.prisma.usageRecord.create({
                data: {
                  organizationId: entry.organizationId,
                  userId: entry.userId,
                  metric: 'ai_tokens',
                  quantity: BigInt(totalTokens),
                  periodStart: start,
                  periodEnd: end,
                  metadata: {
                    provider: entry.provider,
                    model: entry.model,
                    agentId: entry.agentId,
                    executionId: entry.executionId,
                  },
                },
              }),
            ]
          : []),
      ]);
    } catch (error) {
      // Usage accounting must never fail the user's request; it is logged loudly instead.
      this.logger.error(
        { err: error, organizationId: entry.organizationId },
        'failed to record AI usage',
      );
    }
    return { estimatedCostUsd };
  }
}
