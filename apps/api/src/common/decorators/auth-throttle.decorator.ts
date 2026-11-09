import { SetMetadata } from '@nestjs/common';

export const AUTH_THROTTLE_KEY = 'hta:authThrottle';

/** Applies the stricter `AUTH_RATE_LIMIT_MAX` limit (login, register, forgot-password…). */
export const AuthThrottle = () => SetMetadata(AUTH_THROTTLE_KEY, true);
