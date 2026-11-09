import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from './env.schema';

/** Typed access to the validated environment (see `env.schema.ts`). */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('isProduction');
  }

  get isTest(): boolean {
    return this.get('isTest');
  }
}
