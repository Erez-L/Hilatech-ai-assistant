import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';

import { AppConfig } from '../../config/app-config.service';
import { BillingModule } from '../billing/billing.module';
import { DocumentsService } from './documents.service';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { KnowledgeController } from './knowledge.controller';

/**
 * Knowledge bases, documents and retrieval (`/knowledge/*`). The searcher/embedding bindings come from
 * the global `AiCoreModule`; files go through the global `StorageModule`; processing runs in the workers.
 */
@Module({
  imports: [
    BillingModule,
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        // Memory storage (default): validated, hashed and written to the storage driver by the service.
        limits: { fileSize: config.get('MAX_UPLOAD_MB') * 1024 * 1024, files: 1, fields: 10 },
        // Multer decodes multipart file names as latin1 by default; use UTF-8 (Hebrew names).
        defParamCharset: 'utf8',
      }),
    }),
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeBasesService, DocumentsService, KnowledgeSearchService],
  exports: [KnowledgeBasesService, DocumentsService],
})
export class KnowledgeModule {}
