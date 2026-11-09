import { Global, Module } from '@nestjs/common';

import { DomainEventsService } from './domain-events.service';

/** Global so existing services can inject `DomainEventsService` without module wiring changes. */
@Global()
@Module({ providers: [DomainEventsService], exports: [DomainEventsService] })
export class DomainEventsModule {}
