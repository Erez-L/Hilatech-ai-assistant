import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Loads the validated membership for (user, organization) and builds the `TenantContext`. */
@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveTenant(userId: string, organizationId: string): Promise<TenantContext | null> {
    const membership = await this.prisma.client.organizationMember.findFirst({
      where: {
        userId,
        organizationId,
        status: 'active',
        organization: { deletedAt: null },
        user: { isActive: true },
      },
      select: {
        id: true,
        organizationId: true,
        roleId: true,
        role: { select: { key: true, permissions: true } },
      },
    });
    if (!membership) return null;
    return {
      organizationId: membership.organizationId,
      userId,
      memberId: membership.id,
      roleId: membership.roleId,
      roleKey: membership.role.key,
      permissions: membership.role.permissions,
    };
  }
}
