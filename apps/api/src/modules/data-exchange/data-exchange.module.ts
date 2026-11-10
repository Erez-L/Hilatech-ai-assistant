import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';

import { AppConfig } from '../../config/app-config.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/** CSV import jobs (`/imports`, executed by the workers) and CSV exports (`/export/*`). */
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        limits: { fileSize: config.get('MAX_UPLOAD_MB') * 1024 * 1024, files: 1, fields: 5 },
        defParamCharset: 'utf8',
      }),
    }),
  ],
  controllers: [ImportsController, ExportsController],
  providers: [ImportsService, ExportsService],
})
export class DataExchangeModule {}
