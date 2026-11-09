import type { OutboundPolicy } from '@hilatech/shared';
import type { WorkersEnv } from '../config/env.schema';

/** SSRF policy for all server-initiated requests: public https only; loopback/http outside production. */
export function outboundPolicyFor(
  env: Pick<WorkersEnv, 'NODE_ENV' | 'OUTBOUND_ALLOWED_HOSTS'>,
): OutboundPolicy {
  return {
    allowLocalhost: env.NODE_ENV !== 'production',
    allowedHosts: env.OUTBOUND_ALLOWED_HOSTS,
  };
}
