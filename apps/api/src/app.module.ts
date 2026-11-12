import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { EmailVerifiedGuard } from './common/guards/email-verified.guard';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AppConfig } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { buildLoggerParams } from './config/logger.config';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { EmailModule } from './infrastructure/email/email.module';
import { HealthModule } from './infrastructure/health/health.module';
import { OutboundHttpModule } from './infrastructure/http/http.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AgentsModule } from './modules/ai/agents/agents.module';
import { EvaluationsModule } from './modules/ai/evaluations/evaluations.module';
import { AiPlatformModule } from './modules/ai/ai-platform.module';
import { AssistantModule } from './modules/ai/assistant/assistant.module';
import { AiCoreModule } from './modules/ai/core/ai-core.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { BillingModule } from './modules/billing/billing.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { DataExchangeModule } from './modules/data-exchange/data-exchange.module';
import { DealsModule } from './modules/deals/deals.module';
import { DomainEventsModule } from './modules/events/domain-events.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { LeadsModule } from './modules/leads/leads.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { OrganizationGuard } from './modules/tenancy/organization.guard';
import { PermissionsGuard } from './modules/tenancy/permissions.guard';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        buildLoggerParams({
          LOG_LEVEL: config.get('LOG_LEVEL'),
          NODE_ENV: config.get('NODE_ENV'),
          isProduction: config.isProduction,
          isTest: config.isTest,
        }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get('RATE_LIMIT_TTL_SECONDS') * 1000,
            limit: config.get('RATE_LIMIT_MAX'),
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    StorageModule,
    EmailModule,
    CryptoModule,
    OutboundHttpModule,
    DomainEventsModule,
    HealthModule,
    AuditModule,
    TenancyModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    BillingModule,
    // Priority 2 — core business modules
    NotificationsModule,
    ContactsModule,
    LeadsModule,
    TasksModule,
    CompaniesModule,
    DealsModule,
    DataExchangeModule,
    ConversationsModule,
    AnalyticsModule,
    // Priority 3 — AI platform (engine bindings, provider config/usage/prompts/tools, assistant, agents)
    AiCoreModule,
    AiPlatformModule,
    AssistantModule,
    AgentsModule,
    EvaluationsModule,
    // Priority 4 — knowledge base, documents and retrieval
    KnowledgeModule,
    // Priority 4 — automation: workflows, webhooks (in/out), integrations
    WorkflowsModule,
    WebhooksModule,
    IntegrationsModule,
  ],
  providers: [
    // Global guards run in registration order: rate limit → authentication → email verification → tenant → permissions.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: EmailVerifiedGuard },
    { provide: APP_GUARD, useClass: OrganizationGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    {
      provide: APP_INTERCEPTOR,
      inject: [AppConfig, Reflector],
      useFactory: (config: AppConfig, reflector: Reflector) =>
        new TimeoutInterceptor(config.get('REQUEST_TIMEOUT_MS'), reflector),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
