import { type StorageDriver, createStorageDriver } from '@hilatech/storage';
import { Global, Module } from '@nestjs/common';

import { AppConfig } from '../../config/app-config.service';

/** Injection token for the object storage driver (local disk in development, S3-compatible in production). */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [AppConfig],
      useFactory: (config: AppConfig): StorageDriver =>
        createStorageDriver({
          driver: config.get('STORAGE_DRIVER'),
          localPath: config.get('STORAGE_LOCAL_PATH'),
          s3: {
            bucket: config.get('S3_BUCKET') ?? '',
            region: config.get('S3_REGION') ?? 'us-east-1',
            endpoint: config.get('S3_ENDPOINT'),
            accessKeyId: config.get('S3_ACCESS_KEY_ID'),
            secretAccessKey: config.get('S3_SECRET_ACCESS_KEY'),
          },
        }),
    },
  ],
  exports: [STORAGE_DRIVER],
})
export class StorageModule {}
