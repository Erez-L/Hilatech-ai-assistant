import { Module } from '@nestjs/common';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import {
  AI_MODEL_RESOLVER,
  AiRuntime,
  createProviderResolver,
  type ModelResolver,
} from './ai-runtime';
import { RedisCancellationSignal } from './redis-cancellation.signal';

/**
 * Nest wiring for the AI engine inside the workers. `AI_MODEL_RESOLVER` is the only seam that depends
 * on stored credentials; everything else is pure wiring over Prisma and Redis.
 */
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [
    RedisCancellationSignal,
    {
      provide: AI_MODEL_RESOLVER,
      useFactory: (prisma: PrismaService, env: WorkersEnv): ModelResolver =>
        createProviderResolver(prisma, env),
      inject: [PrismaService, WORKERS_ENV],
    },
    AiRuntime,
  ],
  exports: [AiRuntime, AI_MODEL_RESOLVER, RedisCancellationSignal],
})
export class AiRuntimeModule {}
