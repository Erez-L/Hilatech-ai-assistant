import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { RedisReservationStore } from './budget-reservations';
import { BudgetService } from './budget.service';
import { EntitlementsService } from './entitlements.service';

@Module({
  imports: [NotificationsModule],
  controllers: [BillingController],
  providers: [BillingService, EntitlementsService, BudgetService, RedisReservationStore],
  exports: [EntitlementsService, BillingService, BudgetService],
})
export class BillingModule {}
