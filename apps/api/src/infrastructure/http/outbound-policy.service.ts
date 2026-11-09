import { type OutboundPolicy } from '@hilatech/shared';
import { Injectable } from '@nestjs/common';

import { AppConfig } from '../../config/app-config.service';

/** SSRF policy for server-initiated requests: public https only; loopback/http allowed outside production. */
@Injectable()
export class OutboundPolicyService {
  readonly policy: OutboundPolicy;

  constructor(config: AppConfig) {
    this.policy = {
      allowLocalhost: !config.isProduction,
      allowedHosts: config.get('OUTBOUND_ALLOWED_HOSTS'),
    };
  }
}
