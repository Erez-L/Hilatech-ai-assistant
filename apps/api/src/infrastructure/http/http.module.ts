import { Global, Module } from '@nestjs/common';

import { OutboundPolicyService } from './outbound-policy.service';

@Global()
@Module({ providers: [OutboundPolicyService], exports: [OutboundPolicyService] })
export class OutboundHttpModule {}
