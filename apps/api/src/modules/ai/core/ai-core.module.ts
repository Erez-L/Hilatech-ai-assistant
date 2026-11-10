import {
  EmbeddingService,
  type EngineLogger,
  PgVectorKnowledgeSearcher,
  PgVectorStore,
  PricingTable,
  PrismaExecutionStore,
  PrismaUsageRecorder,
  ProviderResolver,
  ToolRegistry,
  createKnowledgeSearchTool,
  crmTools,
  salesTools,
  timeNowTool,
} from '@hilatech/ai-engine';
import { Global, Module } from '@nestjs/common';
import { Logger, PinoLogger } from 'nestjs-pino';

import { AppConfig } from '../../../config/app-config.service';
import { OutboundHttpModule } from '../../../infrastructure/http/http.module';
import { OutboundPolicyService } from '../../../infrastructure/http/outbound-policy.service';
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
  imports: [OutboundHttpModule],
  providers: [
    CancellationService,
    {
      provide: ENGINE_LOGGER,
      inject: [PinoLogger],
      useFactory: (pino: PinoLogger): EngineLogger => createEngineLogger(pino),
    },
    {
      provide: ProviderResolver,
      inject: [PrismaService, AppConfig, OutboundPolicyService],
      useFactory: (prisma: PrismaService, config: AppConfig, outbound: OutboundPolicyService) =>
        new ProviderResolver(prisma.client, {
          outboundPolicy: outbound.policy,
          encryptionKey: config.get('CREDENTIALS_ENCRYPTION_KEY'),
          providerOptions: {
            nodeEnv: config.get('NODE_ENV'),
            allowMock: config.get('AI_ALLOW_MOCK_PROVIDER'),
          },
          timeoutMs: config.get('AI_PROVIDER_TIMEOUT_MS'),
        }),
    },
    {
      provide: EmbeddingService,
      inject: [ProviderResolver, PrismaUsageRecorder, ENGINE_LOGGER],
      useFactory: (resolver: ProviderResolver, usage: PrismaUsageRecorder, logger: EngineLogger) =>
        new EmbeddingService(resolver, usage, logger),
    },
    {
      provide: PgVectorStore,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PgVectorStore(prisma.client),
    },
    {
      provide: PgVectorKnowledgeSearcher,
      inject: [EmbeddingService, PgVectorStore],
      useFactory: (embeddings: EmbeddingService, store: PgVectorStore) =>
        new PgVectorKnowledgeSearcher(embeddings, store),
    },
    {
      provide: ToolRegistry,
      inject: [PgVectorKnowledgeSearcher],
      useFactory: (searcher: PgVectorKnowledgeSearcher) =>
        new ToolRegistry().registerAll([
          ...crmTools,
          ...salesTools,
          timeNowTool,
          // Permission-gated (knowledge:read) semantic search; passages are returned as untrusted <data>.
          createKnowledgeSearchTool(searcher),
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
    EmbeddingService,
    PgVectorStore,
    PgVectorKnowledgeSearcher,
    PricingTable,
    PrismaUsageRecorder,
    PrismaExecutionStore,
    AiRunnersService,
  ],
})
export class AiCoreModule {}
