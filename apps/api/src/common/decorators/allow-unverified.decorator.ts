import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_KEY = 'hta:allowUnverified';

/**
 * Keeps a route reachable for signed-in users whose email is not verified yet, even when
 * `REQUIRE_EMAIL_VERIFICATION` is on (session, profile and the verification flow itself).
 */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
