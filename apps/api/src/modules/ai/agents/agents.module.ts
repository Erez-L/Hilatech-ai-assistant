import { Module } from '@nestjs/common';

import { BillingModule } from '../../billing/billing.module';
import { AiPlatformModule } from '../ai-platform.module';
import { AgentExecutionsService } from './agent-executions.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

/** `/agents/*`: agent definitions, executions (async via `ai-tasks`, sync inline) and cancellation. */
@Module({
  imports: [BillingModule, AiPlatformModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentExecutionsService],
  exports: [AgentsService, AgentExecutionsService],
})
export class AgentsModule {}
