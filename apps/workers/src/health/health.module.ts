import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { RedisModule } from '../redis/redis.module';
import { HealthServer } from './health.server';
import { HealthService } from './health.service';

@Module({
  imports: [RedisModule, PrismaModule, QueueModule],
  providers: [HealthService, HealthServer],
  exports: [HealthService, HealthServer],
})
export class HealthModule {}
