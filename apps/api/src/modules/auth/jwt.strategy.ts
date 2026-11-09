import { ErrorCode, accessTokenClaimsSchema } from '@hilatech/contracts';
import { type Principal } from '@hilatech/types';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AppException } from '../../common/errors/app.exception';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Validates the Bearer access token and resolves the `Principal`. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: unknown): Promise<Principal> {
    const claims = accessTokenClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw AppException.unauthorized('Invalid access token', ErrorCode.TOKEN_INVALID);
    }
    // Cheap PK lookup so deactivated/deleted accounts are locked out immediately (not only after TTL).
    const user = await this.prisma.client.user.findUnique({
      where: { id: claims.data.sub },
      select: { id: true, email: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw AppException.unauthorized('Account is not active');
    }
    return { userId: user.id, email: user.email, sessionId: claims.data.sid };
  }
}
