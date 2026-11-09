import { type Permission } from '@hilatech/contracts';
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'hta:permissions';

/** Every listed permission must be present in `TenantContext.permissions` (AND semantics). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
