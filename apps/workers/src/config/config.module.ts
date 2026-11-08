import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv, type WorkersEnv } from './env.schema';

/** Injection token for the validated environment object (`WorkersEnv`). */
export const WORKERS_ENV = Symbol('WORKERS_ENV');

/**
 * `ConfigModule.validate` runs synchronously while the module is built; we capture its result so the
 * validated object itself (defaults applied, numbers coerced, empty strings normalised to `undefined`)
 * is what gets injected — `ConfigService.get()` would fall back to raw `process.env` strings for
 * optional keys such as `SMTP_HOST=`.
 */
const state: { env?: WorkersEnv } = {};

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: false,
      cache: true,
      // Works from apps/workers (pnpm --filter) and from the repo root (node apps/workers/dist/main.js).
      envFilePath: ['.env', '../../.env'],
      validate: (config) => {
        state.env = validateEnv(config);
        return state.env;
      },
    }),
  ],
  providers: [
    {
      provide: WORKERS_ENV,
      useFactory: (): WorkersEnv => {
        if (!state.env) throw new Error('Workers environment was not validated');
        return state.env;
      },
    },
  ],
  exports: [WORKERS_ENV],
})
export class WorkersConfigModule {}
