import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AppConfig } from '../../config/app-config.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

/**
 * Per-account login throttle (on top of the per-IP rate limit): after `LOGIN_MAX_FAILED_ATTEMPTS`
 * failed logins for the same email within `LOGIN_LOCKOUT_WINDOW`, further attempts for that email are
 * refused until the window expires, whatever IP they come from. A successful login clears the count.
 *
 * The counter lives in Redis under a hash of the email (no address is stored). If Redis is
 * unreachable the throttle fails open: the per-IP limiter and argon2 cost still apply.
 */
@Injectable()
export class LoginThrottleService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    @InjectPinoLogger(LoginThrottleService.name) private readonly logger: PinoLogger,
  ) {}

  private get max(): number {
    return this.config.get('LOGIN_MAX_FAILED_ATTEMPTS');
  }

  private key(email: string): string {
    const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    return `auth:login-failures:${digest}`;
  }

  /** True when the account has reached the failure limit and must wait for the window to expire. */
  async isLocked(email: string): Promise<boolean> {
    if (this.max <= 0) return false;
    try {
      const client = await this.redis.ensureConnected();
      const count = Number((await client.get(this.key(email))) ?? 0);
      return count >= this.max;
    } catch (error) {
      this.logger.warn({ err: error }, 'login throttle unavailable (redis); failing open');
      return false;
    }
  }

  /** Counts a failed attempt; the window starts with the first failure. */
  async recordFailure(email: string): Promise<void> {
    if (this.max <= 0) return;
    try {
      const client = await this.redis.ensureConnected();
      const key = this.key(email);
      const count = await client.incr(key);
      if (count === 1) await client.pexpire(key, this.config.get('loginLockoutWindowMs'));
    } catch (error) {
      this.logger.warn({ err: error }, 'login throttle unavailable (redis); failure not counted');
    }
  }

  async reset(email: string): Promise<void> {
    if (this.max <= 0) return;
    try {
      const client = await this.redis.ensureConnected();
      await client.del(this.key(email));
    } catch {
      // Best effort: the counter expires on its own.
    }
  }
}
