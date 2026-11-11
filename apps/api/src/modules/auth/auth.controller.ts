import {
  type ChangePasswordRequest,
  ErrorCode,
  type ForgotPasswordRequest,
  type LoginRequest,
  ORGANIZATION_HEADER,
  type RegisterRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
  authResponseSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sessionSchema,
  verifyEmailSchema,
} from '@hilatech/contracts';
import { type Principal } from '@hilatech/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { z } from 'zod';

import {
  AllowUnverified,
  AuthThrottle,
  CurrentUser,
  NoTenant,
  Public,
  Req,
} from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodResponse,
  COMMON_AUTH_ERRORS,
} from '../../common/openapi/zod-openapi';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestMeta } from '../../common/request';
import { AuthService } from './auth.service';
import {
  type AcceptedResponse,
  type AuthResult,
  acceptedResponseSchema,
  authSessionSchema,
} from './auth.types';
import { TokenService } from './token.service';

/** Name of the cookie security scheme registered in main.ts (Swagger). */
export const REFRESH_COOKIE_SECURITY = 'refreshCookie';

@ApiTags('auth')
@AllowUnverified()
@Controller('auth')
@NoTenant()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Post('register')
  @Public()
  @AuthThrottle()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an account (optionally joining an organization via invitation token)',
  })
  @ApiZodBody(registerSchema)
  @ApiZodResponse(authResponseSchema, {
    status: HttpStatus.CREATED,
    description: 'Account created; refresh cookie set',
  })
  @ApiErrors(
    [
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      ErrorCode.TOKEN_EXPIRED,
      ErrorCode.TOKEN_INVALID,
    ],
    [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
    [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED],
  )
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterRequest,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(res, await this.auth.register(body, requestMeta(req)));
  }

  @Post('login')
  @Public()
  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiZodBody(loginSchema)
  @ApiZodResponse(authResponseSchema, { description: 'Authenticated; refresh cookie set' })
  @ApiErrors(
    [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR],
    [HttpStatus.UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS],
    [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED],
  )
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginRequest,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(res, await this.auth.login(body, requestMeta(req)));
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE_SECURITY)
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  @ApiZodResponse(authResponseSchema)
  @ApiErrors([
    HttpStatus.UNAUTHORIZED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.TOKEN_REUSED,
  ])
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respondWithSession(
        res,
        await this.auth.refresh(this.readRefreshCookie(req), requestMeta(req)),
      );
    } catch (error) {
      res.clearCookie(this.tokens.refreshCookieName, this.tokens.cookieOptions());
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(REFRESH_COOKIE_SECURITY)
  @ApiOperation({ summary: 'Revoke the current session and clear the refresh cookie' })
  @ApiZodResponse(null)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(this.readRefreshCookie(req), req.user, requestMeta(req));
    res.clearCookie(this.tokens.refreshCookieName, this.tokens.cookieOptions());
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiHeader({
    name: ORGANIZATION_HEADER,
    required: false,
    description: 'Resolve permissions for this organization',
  })
  @ApiOperation({
    summary: 'Current user, organizations and permissions of the selected organization',
  })
  @ApiZodResponse(sessionSchema)
  @ApiErrors(...COMMON_AUTH_ERRORS)
  me(@CurrentUser() principal: Principal, @Headers(ORGANIZATION_HEADER) organizationId?: string) {
    return this.auth.me(principal, organizationId);
  }

  @Post('forgot-password')
  @Public()
  @AuthThrottle()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a password reset email (always 202)' })
  @ApiZodBody(forgotPasswordSchema)
  @ApiZodResponse(acceptedResponseSchema, { status: HttpStatus.ACCEPTED })
  @ApiErrors(
    [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR],
    [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED],
  )
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordRequest,
    @Req() req: AppRequest,
  ): Promise<AcceptedResponse> {
    await this.auth.forgotPassword(body, requestMeta(req));
    return {
      accepted: true,
      message: 'If an account exists for this email, a reset link has been sent',
    };
  }

  @Post('reset-password')
  @Public()
  @AuthThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with a reset token (revokes all sessions)' })
  @ApiZodBody(resetPasswordSchema)
  @ApiZodResponse(null)
  @ApiErrors([
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
  ])
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordRequest,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.auth.resetPassword(body, requestMeta(req));
  }

  @Post('verify-email')
  @Public()
  @AuthThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Verify an email address with the emailed token' })
  @ApiZodBody(verifyEmailSchema)
  @ApiZodResponse(null)
  @ApiErrors([
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
  ])
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailRequest,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.auth.verifyEmail(body, requestMeta(req));
  }

  @Post('resend-verification')
  @ApiBearerAuth()
  @AuthThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Send a new verification email to the signed-in user (no-op when already verified)',
  })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_AUTH_ERRORS, [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED])
  async resendVerification(
    @CurrentUser() principal: Principal,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.auth.resendVerification(principal, requestMeta(req));
  }

  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change password (revokes every other session)' })
  @ApiZodBody(changePasswordSchema)
  @ApiZodResponse(null)
  @ApiErrors(
    ...COMMON_AUTH_ERRORS,
    [HttpStatus.UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS],
    [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR],
  )
  async changePassword(
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordRequest,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.auth.changePassword(principal, body, requestMeta(req));
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active sessions (refresh-token families)' })
  @ApiZodResponse(z.array(authSessionSchema))
  @ApiErrors(...COMMON_AUTH_ERRORS)
  sessions(@CurrentUser() principal: Principal) {
    return this.auth.listSessions(principal);
  }

  @Delete('sessions/:familyId')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a session' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_AUTH_ERRORS, [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND])
  async revokeSession(
    @CurrentUser() principal: Principal,
    @Param('familyId', UuidPipe) familyId: string,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.revokeSession(principal, familyId, requestMeta(req));
    if (familyId === principal.sessionId)
      res.clearCookie(this.tokens.refreshCookieName, this.tokens.cookieOptions());
  }

  private respondWithSession(res: Response, result: AuthResult) {
    res.cookie(
      this.tokens.refreshCookieName,
      result.refreshToken,
      this.tokens.cookieOptions(result.refreshExpiresAt),
    );
    return result.body;
  }

  private readRefreshCookie(req: AppRequest): string | undefined {
    const cookies = (req as AppRequest & { cookies?: Record<string, unknown> }).cookies;
    const value = cookies?.[this.tokens.refreshCookieName];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
