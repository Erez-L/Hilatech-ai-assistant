import { Module } from '@nestjs/common';

import { CrmModule } from '../crm/crm.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';

@Module({
  imports: [CrmModule],
  controllers: [DealsController, PipelinesController],
  providers: [DealsService, PipelinesService],
  exports: [DealsService, PipelinesService],
})
export class DealsModule {}
