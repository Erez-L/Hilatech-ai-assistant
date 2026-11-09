import { Global, Module } from '@nestjs/common';

import { OrganizationGuard } from './organization.guard';
import { PermissionsGuard } from './permissions.guard';
import { TenancyService } from './tenancy.service';

@Global()
@Module({
  providers: [TenancyService, OrganizationGuard, PermissionsGuard],
  exports: [TenancyService, OrganizationGuard, PermissionsGuard],
})
export class TenancyModule {}
