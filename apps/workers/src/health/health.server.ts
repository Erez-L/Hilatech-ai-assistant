import { Inject, Injectable, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { HealthService, httpStatusFor } from './health.service';

/**
 * Minimal `node:http` server (no web framework) exposing `GET /health` on `WORKERS_HEALTH_PORT`.
 * Returns 200 when Redis and the database answer, 503 (`status: "degraded"`) otherwise.
 *
 * Shutdown order: workers drain in `onModuleDestroy`; this server closes in
 * `beforeApplicationShutdown` (still answering probes while jobs finish); Prisma/Redis disconnect
 * last in `onApplicationShutdown`.
 */
@Injectable()
export class HealthServer implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private server?: Server;

  constructor(
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    private readonly health: HealthService,
    @InjectPinoLogger(HealthServer.name) private readonly logger: PinoLogger,
  ) {}

  /** Port actually bound (differs from the env value only when it is 0 → ephemeral, used by tests). */
  get port(): number {
    const address = this.server?.address();
    return address && typeof address === 'object' ? (address as AddressInfo).port : this.env.WORKERS_HEALTH_PORT;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.listen();
  }

  async listen(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.handle(req, res));
    server.keepAliveTimeout = 5_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.env.WORKERS_HEALTH_PORT, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (err) => this.logger.error({ err }, 'Health server error'));
    this.server = server;
    this.logger.info({ port: this.port, path: '/health' }, 'Health endpoint listening');
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    this.logger.info('Health endpoint closed');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    if (url.pathname !== '/health') {
      res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    try {
      const health = await this.health.check();
      res.writeHead(httpStatusFor(health));
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(health));
    } catch (err) {
      this.logger.error({ err }, 'Health check failed');
      res.writeHead(503).end(JSON.stringify({ status: 'degraded', error: 'health_check_failed' }));
    }
  }
}
