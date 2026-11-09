import { Global, Module } from '@nestjs/common';
import { createStorageDriver, type StorageDriver } from '@hilatech/storage';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';

/** Injection token for the object storage driver (same configuration as the API's). */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [WORKERS_ENV],
      useFactory: (env: WorkersEnv): StorageDriver =>
        createStorageDriver({
          driver: env.STORAGE_DRIVER,
          localPath: env.STORAGE_LOCAL_PATH,
          s3: {
            bucket: env.S3_BUCKET ?? '',
            region: env.S3_REGION ?? 'us-east-1',
            endpoint: env.S3_ENDPOINT,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }),
    },
  ],
  exports: [STORAGE_DRIVER],
})
export class StorageModule {}
