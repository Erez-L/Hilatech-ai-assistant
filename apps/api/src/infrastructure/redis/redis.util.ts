import { type RedisOptions } from 'ioredis';

/** Convert `redis://[user:pass@]host:port[/db]` (or `rediss://`) into ioredis options. */
export function redisOptionsFromUrl(url: string, overrides: RedisOptions = {}): RedisOptions {
  const parsed = new URL(url);
  const db = parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.slice(1)) : 0;
  const options: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    db: Number.isFinite(db) ? db : 0,
    lazyConnect: false,
    ...overrides,
  };
  if (parsed.username) options.username = decodeURIComponent(parsed.username);
  if (parsed.password) options.password = decodeURIComponent(parsed.password);
  if (parsed.protocol === 'rediss:') options.tls = {};
  return options;
}
