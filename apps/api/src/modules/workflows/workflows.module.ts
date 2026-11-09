import { Module } from '@nestjs/common';

import { WorkflowExecutionsController, WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

/** `/workflows/*` and `/workflow-executions/*`: definitions, validation, manual runs, execution history. */
@Module({
  controllers: [WorkflowsController, WorkflowExecutionsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
