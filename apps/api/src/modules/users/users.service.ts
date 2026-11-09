import { type AuthUser } from '@hilatech/contracts';
import { type Prisma } from '@hilatech/database';
import { type Principal } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { toAuthUser } from '../auth/auth.mappers';
import {
  DEFAULT_PREFERENCES,
  type UpdateProfileRequest,
  type UserPreferences,
  userPreferencesSchema,
} from './users.schemas';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(principal: Principal): Promise<AuthUser> {
    const user = await this.prisma.client.user.findUnique({ where: { id: principal.userId } });
    if (!user) throw AppException.notFound('User');
    return toAuthUser(user);
  }

  async updateProfile(principal: Principal, dto: UpdateProfileRequest): Promise<AuthUser> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    const user = await this.prisma.client.user.update({ where: { id: principal.userId }, data });
    return toAuthUser(user);
  }

  async getPreferences(principal: Principal): Promise<UserPreferences> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: principal.userId },
      select: { preferences: true },
    });
    if (!user) throw AppException.notFound('User');
    const parsed = userPreferencesSchema.safeParse(user.preferences ?? {});
    return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
  }

  async replacePreferences(
    principal: Principal,
    preferences: UserPreferences,
  ): Promise<UserPreferences> {
    await this.prisma.client.user.update({
      where: { id: principal.userId },
      data: { preferences: preferences as Prisma.InputJsonObject },
    });
    return preferences;
  }
}
