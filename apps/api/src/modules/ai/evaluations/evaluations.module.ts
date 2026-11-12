import { Module } from '@nestjs/common';

import { BillingModule } from '../../billing/billing.module';
import { AgentsModule } from '../agents/agents.module';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';

/** `/evaluations/*`: datasets and cases (CRUD) and runs (executed by the workers on `ai-tasks`). */
@Module({
  imports: [BillingModule, AgentsModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService],
})
export class EvaluationsModule {}
