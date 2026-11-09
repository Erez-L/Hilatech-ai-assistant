import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ALL_QUEUES } from '@hilatech/contracts';
import { Logger } from 'nestjs-pino';
import { WORKERS_ENV } from './config/config.module';
import type { WorkersEnv } from './config/env.schema';
import { HealthServer } from './health/health.server';

const CONTEXT = 'Bootstrap';

async function bootstrap(): Promise<void> {
  // Imported lazily so an invalid environment surfaces as a readable error below instead of an
  // unhandled exception thrown while the module graph is being evaluated.
  const { AppModule } = await import('./app.module');

  // createApplicationContext() runs the init hooks: Prisma connects, workers start, health listens.
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();

  const env = app.get<WorkersEnv>(WORKERS_ENV);
  const health = app.get(HealthServer);
  logger.log(
    `Workers ready — ${ALL_QUEUES.length} queues, health on http://0.0.0.0:${health.port}/health`,
    CONTEXT,
  );

  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) {
      logger.warn(`Received ${reason} during shutdown; exiting immediately`, CONTEXT);
      process.exit(1);
    }
    shuttingDown = true;
    logger.log(
      `Received ${reason}; shutting down gracefully (timeout ${env.SHUTDOWN_TIMEOUT_SECONDS}s)`,
      CONTEXT,
    );
    const timer = setTimeout(() => {
      logger.error('Graceful shutdown timed out; exiting', undefined, CONTEXT);
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_SECONDS * 1000);
    timer.unref();

    try {
      // Hook order inside app.close(): onModuleDestroy (workers drain, metrics + health stop) →
      // onApplicationShutdown (Prisma disconnect, Redis quit).
      await app.close();
      logger.log('Shutdown complete', CONTEXT);
      process.exit(exitCode);
    } catch (err) {
      logger.error(`Shutdown failed: ${(err as Error).message}`, (err as Error).stack, CONTEXT);
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(`Unhandled promise rejection: ${err.message}`, err.stack, CONTEXT);
  });
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`, err.stack, CONTEXT);
    void shutdown('uncaughtException', 1);
  });
}

bootstrap().catch((err: unknown) => {
  // The logger may not exist yet; this is the one place a raw console write is appropriate.
  console.error('[workers] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
