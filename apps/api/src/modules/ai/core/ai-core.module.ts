import {
  type EngineLogger,
  PricingTable,
  PrismaExecutionStore,
  PrismaUsageRecorder,
  ProviderResolver,
  ToolRegistry,
  createKnowledgeSearchTool,
  crmTools,
  timeNowTool,
} from '@hilatech/ai-engine';
import { Global, Module } from '@nestjs/common';
import { Logger, PinoLogger } from 'nestjs-pino';

import { AppConfig } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AiRunnersService } from './ai-runners.service';
import { CancellationService } from './cancellation.service';
import { ENGINE_LOGGER, createEngineLogger } from './engine-logger';

/**
 * Nest providers wrapping `@hilatech/ai-engine`: the engine stays framework-free (ADR-009) and this
 * module binds it to the API's configuration, Prisma client, Redis (cancellation), audit log and logger.
 * Global so the assistant, agents and AI-platform modules share one registry, resolver cache and runners.
 */
@Global()
@Module({
  providers: [
    CancellationService,
    {
      provide: ENGINE_LOGGER,
      inject: [PinoLogger],
      useFactory: (pino: PinoLogger): EngineLogger => createEngineLogger(pino),
    },
    {
      provide: ProviderResolver,
      inject: [PrismaService, AppConfig],
      useFactory: (prisma: PrismaService, config: AppConfig) =>
        new ProviderResolver(prisma.client, {
          encryptionKey: config.get('CREDENTIALS_ENCRYPTION_KEY'),
          providerOptions: {
            nodeEnv: config.get('NODE_ENV'),
            allowMock: config.get('AI_ALLOW_MOCK_PROVIDER'),
          },
          timeoutMs: config.get('AI_PROVIDER_TIMEOUT_MS'),
        }),
    },
    {
      provide: ToolRegistry,
      useFactory: () =>
        new ToolRegistry().registerAll([
          ...crmTools,
          timeNowTool,
          // Knowledge retrieval is wired in Priority 4; until then the tool reports `not_configured`.
          createKnowledgeSearchTool(null),
        ]),
    },
    {
      provide: PricingTable,
      inject: [AppConfig, Logger],
      useFactory: (config: AppConfig, logger: Logger) => {
        const { table, error } = PricingTable.fromJson(config.get('AI_PRICING_JSON'));
        if (error) {
          logger.warn(
            { err: error },
            'AI_PRICING_JSON could not be parsed; cost estimates will be null',
            'AiCoreModule',
          );
        }
        return table;
      },
    },
    {
      provide: PrismaUsageRecorder,
      inject: [PrismaService, PricingTable, ENGINE_LOGGER],
      useFactory: (prisma: PrismaService, pricing: PricingTable, logger: EngineLogger) =>
        new PrismaUsageRecorder(prisma.client, { pricing, logger }),
    },
    {
      provide: PrismaExecutionStore,
      inject: [PrismaService, CancellationService],
      useFactory: (prisma: PrismaService, cancellation: CancellationService) =>
        new PrismaExecutionStore(prisma.client, cancellation),
    },
    AiRunnersService,
  ],
  exports: [
    CancellationService,
    ENGINE_LOGGER,
    ProviderResolver,
    ToolRegistry,
    PricingTable,
    PrismaUsageRecorder,
    PrismaExecutionStore,
    AiRunnersService,
  ],
})
export class AiCoreModule {}
