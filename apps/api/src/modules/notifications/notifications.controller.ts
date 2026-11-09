import {
  ErrorCode,
  type ListNotificationsQuery,
  type NotificationPreferences,
  Permission,
  listNotificationsQuerySchema,
  notificationPreferencesSchema,
  notificationSchema,
  unreadCountSchema,
} from '@hilatech/contracts';
import { type Principal, type TenantContext } from '@hilatech/types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser, NoTenant, RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_AUTH_ERRORS,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

/** TODO(contracts): add `readAllResultSchema` to `@hilatech/contracts/platform`. */
const readAllResultSchema = z.object({ updated: z.number().int().nonnegative() });

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiSecurity('organization')
  @RequirePermissions(Permission.NOTIFICATIONS_READ)
  @ApiOperation({
    summary: "The caller's notifications for the selected organization (plus platform-wide ones)",
  })
  @ApiZodQuery(listNotificationsQuerySchema)
  @ApiZodResponse(notificationSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ) {
    return this.notifications.list(tenant, query);
  }

  @Get('unread-count')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.NOTIFICATIONS_READ)
  @ApiOperation({ summary: 'Number of unread notifications for the caller in this organization' })
  @ApiZodResponse(unreadCountSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  unreadCount(@Tenant() tenant: TenantContext) {
    return this.notifications.unreadCount(tenant);
  }

  @Get('preferences')
  @NoTenant()
  @ApiOperation({
    summary: "The caller's notification preferences (user-level, all organizations)",
  })
  @ApiZodResponse(notificationPreferencesSchema)
  @ApiErrors(...COMMON_AUTH_ERRORS)
  preferences(@CurrentUser() principal: Principal) {
    return this.notifications.getPreferences(principal);
  }

  @Put('preferences')
  @NoTenant()
  @ApiOperation({ summary: "Replace the caller's notification preferences" })
  @ApiZodBody(notificationPreferencesSchema)
  @ApiZodResponse(notificationPreferencesSchema)
  @ApiErrors(...COMMON_AUTH_ERRORS, [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR])
  replacePreferences(
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(notificationPreferencesSchema)) body: NotificationPreferences,
  ) {
    return this.notifications.replacePreferences(principal, body);
  }

  @Post('read-all')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.NOTIFICATIONS_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all of the caller’s notifications in this organization as read' })
  @ApiZodResponse(readAllResultSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  readAll(@Tenant() tenant: TenantContext) {
    return this.notifications.markAllRead(tenant);
  }

  @Post(':id/read')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.NOTIFICATIONS_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one of the caller’s notifications as read' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(notificationSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND])
  read(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.notifications.markRead(tenant, id);
  }
}
