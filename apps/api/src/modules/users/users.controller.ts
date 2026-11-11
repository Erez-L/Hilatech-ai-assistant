import { ErrorCode, authUserSchema } from '@hilatech/contracts';
import { type Principal } from '@hilatech/types';
import { Body, Controller, Get, HttpStatus, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AllowUnverified, CurrentUser, NoTenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodResponse,
  COMMON_AUTH_ERRORS,
} from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  type UpdateProfileRequest,
  type UserPreferences,
  updateProfileSchema,
  userPreferencesSchema,
} from './users.schemas';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@AllowUnverified()
@Controller('users')
@NoTenant()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user profile' })
  @ApiZodResponse(authUserSchema)
  @ApiErrors(...COMMON_AUTH_ERRORS)
  me(@CurrentUser() principal: Principal) {
    return this.users.me(principal);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update profile (firstName, lastName, avatarUrl)' })
  @ApiZodBody(updateProfileSchema)
  @ApiZodResponse(authUserSchema)
  @ApiErrors(...COMMON_AUTH_ERRORS, [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR])
  updateProfile(
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileRequest,
  ) {
    return this.users.updateProfile(principal, body);
  }

  @Get('me/preferences')
  @ApiOperation({ summary: 'Current user preferences' })
  @ApiZodResponse(userPreferencesSchema)
  @ApiErrors(...COMMON_AUTH_ERRORS)
  preferences(@CurrentUser() principal: Principal) {
    return this.users.getPreferences(principal);
  }

  @Put('me/preferences')
  @ApiOperation({ summary: 'Replace user preferences (theme, locale, notifications)' })
  @ApiZodBody(userPreferencesSchema)
  @ApiZodResponse(userPreferencesSchema)
  @ApiErrors(...COMMON_AUTH_ERRORS, [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR])
  replacePreferences(
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(userPreferencesSchema)) body: UserPreferences,
  ) {
    return this.users.replacePreferences(principal, body);
  }
}
