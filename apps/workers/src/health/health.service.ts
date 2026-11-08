import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QueueName } from '@hilatech/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QueueMetricsService, type QueueMetrics } from '../queue/queue-metrics.service';
import { RedisService } from '../redis/redis.service';

export type DependencyStatus = 'up' | 'down';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  redis: DependencyStatus;
  database: DependencyStatus;
  queues: Partial<Record<QueueName, QueueMetrics>>;
  uptimeSeconds: number;
  version: string;
}

/** Interfaces the health check needs — kept minimal so unit tests can pass fakes. */
export interface HealthProbes {
  redis: Pick<RedisService, 'ping'>;
  database: Pick<PrismaService, 'ping'>;
  metrics: Pick<QueueMetricsService, 'snapshot'>;
}

export function readPackageVersion(): string {
  try {
    // apps/workers/{src|dist}/health → apps/workers/package.json (same depth in the Docker `pnpm deploy` output).
    const raw = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function httpStatusFor(health: HealthResponse): number {
  return health.status === 'ok' ? 200 : 503;
}

export async function computeHealth(probes: HealthProbes, version: string, startedAt: number): Promise<HealthResponse> {
  const [redisUp, databaseUp, queues] = await Promise.all([
    probes.redis.ping(),
    probes.database.ping(),
    probes.metrics.snapshot().catch(() => ({}) as Partial<Record<QueueName, QueueMetrics>>),
  ]);
  return {
    status: redisUp && databaseUp ? 'ok' : 'degraded',
    redis: redisUp ? 'up' : 'down',
    database: databaseUp ? 'up' : 'down',
    queues,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    version,
  };
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();
  readonly version = readPackageVersion();

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly metrics: QueueMetricsService,
  ) {}

  check(): Promise<HealthResponse> {
    return computeHealth({ redis: this.redis, database: this.prisma, metrics: this.metrics }, this.version, this.startedAt);
  }
}
