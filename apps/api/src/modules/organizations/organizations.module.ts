import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [BillingModule],
  controllers: [OrganizationsController, MembersController, RolesController, InvitationsController],
  providers: [OrganizationsService, MembersService, RolesService, InvitationsService],
  exports: [OrganizationsService, InvitationsService, RolesService, MembersService],
})
export class OrganizationsModule {}
