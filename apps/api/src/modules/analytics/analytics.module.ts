import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { AnalyticsReportsController } from './analytics-reports.controller';
import { AnalyticsReportsService } from './analytics-reports.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [BillingModule],
  controllers: [AnalyticsController, AnalyticsReportsController],
  providers: [AnalyticsService, AnalyticsReportsService],
})
export class AnalyticsModule {}
