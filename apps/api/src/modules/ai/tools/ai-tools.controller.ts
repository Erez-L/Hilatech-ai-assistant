import { Permission, toolDefinitionSchema } from '@hilatech/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../../common/decorators';
import {
  ApiErrors,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../../common/openapi/zod-openapi';
import { AiToolsService } from './ai-tools.service';

@ApiTags('ai')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('ai/tools')
export class AiToolsController {
  constructor(private readonly tools: AiToolsService) {}

  @Get()
  @RequirePermissions(Permission.AGENTS_READ)
  @ApiOperation({ summary: 'Catalogue of tools assistants and agents may call (incl. delegation)' })
  @ApiZodResponse(toolDefinitionSchema.array())
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list() {
    return this.tools.catalogue();
  }
}
