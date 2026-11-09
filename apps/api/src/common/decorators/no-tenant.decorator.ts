import { SetMetadata } from '@nestjs/common';

export const NO_TENANT_KEY = 'hta:noTenant';

/** Marks an authenticated route as user-scoped: no `x-organization-id` header is required. */
export const NoTenant = () => SetMetadata(NO_TENANT_KEY, true);
