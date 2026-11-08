import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ProcessorsModule } from '../processors/processors.module';
import { QueueMetricsService } from './queue-metrics.service';
import { QueueRegistry } from './queue.registry';

@Module({
  imports: [RedisModule, ProcessorsModule],
  providers: [QueueMetricsService, QueueRegistry],
  exports: [QueueMetricsService, QueueRegistry],
})
export class QueueModule {}
