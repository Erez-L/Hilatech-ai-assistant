import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { WORKERS_ENV, WorkersConfigModule } from './config/config.module';
import type { WorkersEnv } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { buildLoggerOptions } from './logger/logger.options';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';

/**
 * Root module of the workers standalone application. `LoggerModule.forRootAsync` is called here (not
 * in a nested module) so every `@InjectPinoLogger(...)` context in the imported files is registered
 * before nestjs-pino builds its providers.
 */
@Module({
  imports: [
    WorkersConfigModule,
    LoggerModule.forRootAsync({
      inject: [WORKERS_ENV],
      useFactory: (env: WorkersEnv) => buildLoggerOptions(env),
    }),
    RedisModule,
    PrismaModule,
    QueueModule,
    HealthModule,
  ],
})
export class AppModule {}
