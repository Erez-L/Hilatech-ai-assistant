import { ALL_QUEUES } from '@hilatech/contracts';
import type { QueueMetricsSnapshot } from '../queue/queue-metrics.service';
import { computeHealth, httpStatusFor, readPackageVersion, type HealthProbes } from './health.service';

function snapshot(): QueueMetricsSnapshot {
  return Object.fromEntries(
    ALL_QUEUES.map((q) => [q, { waiting: 1, active: 0, completed: 2, failed: 0, delayed: 0, sinceStart: { completed: 2, failed: 0, stalled: 0 } }]),
  ) as QueueMetricsSnapshot;
}

function probes(overrides: { redis?: boolean; database?: boolean; metricsFail?: boolean } = {}): HealthProbes {
  return {
    redis: { ping: jest.fn().mockResolvedValue(overrides.redis ?? true) },
    database: { ping: jest.fn().mockResolvedValue(overrides.database ?? true) },
    metrics: { snapshot: overrides.metricsFail ? jest.fn().mockRejectedValue(new Error('redis timeout')) : jest.fn().mockResolvedValue(snapshot()) },
  };
}

describe('health', () => {
  const startedAt = Date.now() - 12_500;

  it('returns ok / 200 with every queue when all dependencies are up', async () => {
    const health = await computeHealth(probes(), '0.1.0', startedAt);
    expect(health).toEqual({
      status: 'ok',
      redis: 'up',
      database: 'up',
      queues: expect.any(Object),
      uptimeSeconds: expect.any(Number),
      version: '0.1.0',
    });
    expect(Object.keys(health.queues).sort()).toEqual([...ALL_QUEUES].sort());
    for (const q of ALL_QUEUES) {
      expect(health.queues[q]).toMatchObject({ waiting: 1, active: 0, completed: 2, failed: 0, delayed: 0 });
    }
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(12);
    expect(httpStatusFor(health)).toBe(200);
  });

  it('returns degraded / 503 when redis is down (queue counts fall back to an empty object)', async () => {
    const health = await computeHealth(probes({ redis: false, metricsFail: true }), '0.1.0', startedAt);
    expect(health.status).toBe('degraded');
    expect(health.redis).toBe('down');
    expect(health.database).toBe('up');
    expect(health.queues).toEqual({});
    expect(httpStatusFor(health)).toBe(503);
  });

  it('returns degraded / 503 when the database is down', async () => {
    const health = await computeHealth(probes({ database: false }), '0.1.0', startedAt);
    expect(health).toMatchObject({ status: 'degraded', redis: 'up', database: 'down' });
    expect(httpStatusFor(health)).toBe(503);
  });

  it('reads the package version', () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
