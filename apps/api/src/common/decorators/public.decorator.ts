import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'hta:isPublic';

/** Marks a route as reachable without an access token (also skips the tenant guard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
