import 'reflect-metadata';

import {
  API_PREFIX,
  ORGANIZATION_HEADER,
  REFRESH_COOKIE_NAME,
  REQUEST_ID_HEADER,
} from '@hilatech/contracts';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { assignRequestId } from './common/middleware/request-id.middleware';
import { AppConfig } from './config/app-config.service';
import { REFRESH_COOKIE_SECURITY } from './modules/auth/auth.controller';

export interface CreateAppOptions {
  /** Attach the pino logger as the Nest logger (disabled in tests for quiet output). */
  logger?: boolean;
}

/**
 * Builds and configures the Nest application (shared by `main.ts` and the integration tests so both
 * run the exact same middleware, guards and filters).
 */
export async function createApp(options: CreateAppOptions = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const config = app.get(AppConfig);
  if (options.logger !== false) app.useLogger(app.get(Logger));

  app.use(assignRequestId);
  const bodyLimit = config.get('BODY_LIMIT');
  app.useBodyParser('json', {
    limit: bodyLimit,
    // Inbound webhooks verify an HMAC over the exact bytes received, so keep the raw body for /hooks/ only.
    verify: (req: { url?: string; rawBody?: Buffer }, _res: unknown, buf: Buffer) => {
      if (req.url?.includes('/hooks/')) req.rawBody = buf;
    },
  });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });
  app.use(cookieParser());
  app.use(
    helmet({
      // The API serves JSON only; Swagger UI (non-production) needs inline scripts/styles.
      contentSecurityPolicy: config.isProduction ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  if (config.get('TRUST_PROXY')) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', ORGANIZATION_HEADER, REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.enableShutdownHooks();

  if (config.get('swaggerEnabled')) setupSwagger(app);
  return app;
}

function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('HilaTech AI Assistant API')
      .setDescription(
        'Multi-tenant REST API. Authenticate with a Bearer access token; select the organization with the ' +
          `\`${ORGANIZATION_HEADER}\` header. Success responses are wrapped in \`{ data, meta? }\`, errors in ` +
          '`{ error: { code, message, details?, requestId } }`.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: ORGANIZATION_HEADER,
          description: 'Selected organization id',
        },
        'organization',
      )
      .addCookieAuth(
        REFRESH_COOKIE_NAME,
        { type: 'apiKey', in: 'cookie', name: REFRESH_COOKIE_NAME },
        REFRESH_COOKIE_SECURITY,
      )
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  });
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get(AppConfig);
  const logger = app.get(Logger);

  const server = app.getHttpServer() as import('node:http').Server;
  const timeoutMs = config.get('REQUEST_TIMEOUT_MS');
  // keepAlive > typical load-balancer idle timeout (60s); headers > keepAlive; request > headers.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = Math.max(timeoutMs + 5_000, 67_000);

  const port = config.get('API_PORT');
  await app.listen(port);
  logger.log(
    `API listening on http://localhost:${port}${API_PREFIX} (${config.get('NODE_ENV')})` +
      (config.get('swaggerEnabled') ? ` — docs at http://localhost:${port}/api/docs` : ''),
    'Bootstrap',
  );

  // Nest's shutdown hooks (enableShutdownHooks) close the HTTP server, Prisma, Redis and BullMQ on
  // SIGTERM/SIGINT. This guard forces exit if a dependency hangs during shutdown.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.log(`Received ${signal}, shutting down gracefully`, 'Bootstrap');
      setTimeout(() => process.exit(1), 15_000).unref();
    });
  }
}

if (require.main === module) {
  bootstrap().catch((error) => {
    // Logger may not exist yet (e.g. invalid environment) — print and exit non-zero.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
