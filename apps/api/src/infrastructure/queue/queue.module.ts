import { ALL_QUEUES, DEFAULT_JOB_OPTIONS } from '@hilatech/contracts';
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { AppConfig } from '../../config/app-config.service';
import { redisOptionsFromUrl } from '../redis/redis.util';
import { QueueService } from './queue.service';

/** Registers every queue from `ALL_QUEUES` (producer side) and exposes `QueueService`. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: redisOptionsFromUrl(config.get('REDIS_URL'), {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        }),
        prefix: config.get('BULLMQ_PREFIX'),
        defaultJobOptions: { ...DEFAULT_JOB_OPTIONS },
      }),
    }),
    ...ALL_QUEUES.map((name) => BullModule.registerQueue({ name })),
  ],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
