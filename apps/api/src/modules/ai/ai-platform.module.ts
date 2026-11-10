import { OutboundHttpModule } from '../../infrastructure/http/http.module';
import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { PromptTemplatesController } from './prompts/prompt-templates.controller';
import { PromptTemplatesService } from './prompts/prompt-templates.service';
import { AiProvidersController } from './providers/ai-providers.controller';
import { AiProvidersService } from './providers/ai-providers.service';
import { AiToolsController } from './tools/ai-tools.controller';
import { AiToolsService } from './tools/ai-tools.service';
import { AiUsageController } from './usage/ai-usage.controller';
import { AiUsageService } from './usage/ai-usage.service';

/** `/ai/*`: provider configuration, models, usage, prompt templates and the tool catalogue. */
@Module({
  imports: [BillingModule, OutboundHttpModule],
  controllers: [
    AiProvidersController,
    AiUsageController,
    PromptTemplatesController,
    AiToolsController,
  ],
  providers: [AiProvidersService, AiUsageService, PromptTemplatesService, AiToolsService],
  exports: [AiProvidersService, AiToolsService],
})
export class AiPlatformModule {}
