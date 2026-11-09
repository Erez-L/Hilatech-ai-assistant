import { Module } from '@nestjs/common';

import { CrmReferencesService } from './crm-references.service';

/** Helpers shared by the CRM modules (contacts, leads, conversations). No controllers. */
@Module({
  providers: [CrmReferencesService],
  exports: [CrmReferencesService],
})
export class CrmModule {}
