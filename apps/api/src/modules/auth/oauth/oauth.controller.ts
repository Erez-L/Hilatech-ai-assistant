import { API_PREFIX } from '@hilatech/contracts';
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { z } from 'zod';

import { AllowUnverified, AuthThrottle, NoTenant, Public, Req } from '../../../common/decorators';
import { AppException } from '../../../common/errors/app.exception';
import { ApiZodResponse } from '../../../common/openapi/zod-openapi';
import { type AppRequest, requestMeta } from '../../../common/request';
import { AppConfig } from '../../../config/app-config.service';
import { TokenService } from '../token.service';
import { OAUTH_PROVIDERS, type OAuthProviderId, isOAuthProviderId } from './oauth.providers';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  OAuthFlowError,
  OAuthService,
} from './oauth.service';

const providersResponseSchema = z.object({ providers: z.array(z.enum(OAUTH_PROVIDERS)) });

/**
 * Social sign-in. The browser is sent to the provider by `GET :provider/start` and comes back to
 * `GET :provider/callback`, which sets the refresh cookie and redirects to the web app. Failures redirect to
 * `/login?oauth_error=<code>` — these are full-page navigations, so nothing is returned as JSON.
 */
@ApiTags('auth')
@AllowUnverified()
@NoTenant()
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  @Get('providers')
  @Public()
  @ApiOperation({ summary: 'Social sign-in providers that are configured on this server' })
  @ApiZodResponse(providersResponseSchema)
  providers() {
    return { providers: this.oauth.enabledProviders() };
  }

  @Get(':provider/start')
  @Public()
  @AuthThrottle()
  @ApiOperation({ summary: 'Redirect the browser to the provider consent screen' })
  @ApiParam({ name: 'provider', enum: OAUTH_PROVIDERS })
  start(
    @Param('provider') providerParam: string,
    @Query('next') next: string | undefined,
    @Res() res: Response,
  ): void {
    const provider = this.parseProvider(providerParam);
    try {
      const { url, cookie } = this.oauth.start(provider, next);
      res.cookie(OAUTH_STATE_COOKIE, cookie, this.stateCookieOptions(OAUTH_STATE_TTL_MS));
      res.redirect(url);
    } catch (error) {
      this.fail(res, error);
    }
  }

  @Get(':provider/callback')
  @Public()
  @AuthThrottle()
  @ApiOperation({ summary: 'Provider redirect target: signs the user in and redirects to the app' })
  @ApiParam({ name: 'provider', enum: OAUTH_PROVIDERS })
  async callback(
    @Param('provider') providerParam: string,
    @Query() query: Record<string, unknown>,
    @Req() req: AppRequest,
    @Res() res: Response,
  ): Promise<void> {
    const provider = this.parseProvider(providerParam);
    const cookies = (req as AppRequest & { cookies?: Record<string, unknown> }).cookies;
    res.clearCookie(OAUTH_STATE_COOKIE, this.stateCookieOptions());
    try {
      const { result, next } = await this.oauth.callback(
        provider,
        query,
        cookies?.[OAUTH_STATE_COOKIE],
        requestMeta(req),
      );
      res.cookie(
        this.tokens.refreshCookieName,
        result.refreshToken,
        this.tokens.cookieOptions(result.refreshExpiresAt),
      );
      res.redirect(this.oauth.appUrl(next ?? '/dashboard'));
    } catch (error) {
      this.fail(res, error);
    }
  }

  private parseProvider(value: string): OAuthProviderId {
    if (!isOAuthProviderId(value)) throw AppException.notFound('Sign-in provider');
    return value;
  }

  private fail(res: Response, error: unknown): void {
    if (!(error instanceof OAuthFlowError)) throw error;
    res.redirect(this.oauth.appUrl(`/login?oauth_error=${encodeURIComponent(error.code)}`));
  }

  private stateCookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.get('COOKIE_SECURE'),
      path: `${API_PREFIX}/auth/oauth`,
      ...(maxAge ? { maxAge } : {}),
    };
  }
}
