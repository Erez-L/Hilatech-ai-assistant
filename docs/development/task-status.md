# Task Status

Statuses: Not Started · In Progress · Blocked · Implemented · Tested · Verified

| Area | Task | Status | Notes |
| --- | --- | --- | --- |
| Foundation | Monorepo skeleton, configs, Docker Compose, CI | Implemented | |
| Foundation | Prisma schema + initial migration + seed | Verified | migration applied locally, seed OK |
| Foundation | API bootstrap (config validation, logging, filters, Swagger, health) | Not Started | |
| Foundation | Authentication (register/login/refresh/logout/reset/verify) | Not Started | |
| Foundation | Organizations, members, roles, invitations, tenant guards | Not Started | |
| Foundation | Audit logging | Not Started | |
| Foundation | Web app shell, design system, auth pages, onboarding | Not Started | |
| Foundation | Workers bootstrap + queues | Verified | 37 unit + 7 integration tests; 5 queues complete as not_implemented (see Workers rows) |
| Core | Contacts | Not Started | |
| Core | Leads (+ notes, activities, conversion) | Not Started | |
| Core | Conversations + messages | Not Started | |
| Core | Notifications | Not Started | |
| Core | Dashboard analytics summary | Not Started | |
| AI | Provider abstraction + adapters | Not Started | |
| AI | Assistant, agents, orchestration | Not Started | |
| Knowledge | Documents, chunking, embeddings, RAG | Not Started | |
| Automation | Workflows, webhooks, n8n | Not Started | |
| Commercial | Billing architecture, usage limits, entitlements | Not Started | |
| Production | Security review, monitoring, deployment | Not Started | |
| Workers | Standalone NestJS app bootstrap: zod env validation, nestjs-pino (redaction from `SENSITIVE_LOG_PATHS`), PrismaService/RedisService, graceful SIGTERM/SIGINT shutdown | Verified | `apps/workers`; typecheck · lint · 37 unit tests · 7 integration tests · build all green; `node dist/main.js` started against dev env, SIGTERM drains workers then exits 0 |
| Workers | Queue infrastructure: one BullMQ Worker per queue in `ALL_QUEUES`, payload re-validation with `JOB_SCHEMAS` (invalid → `UnrecoverableError`, no retries), per-queue concurrency/lockDuration (ai-tasks 5 min), structured job logs, QueueEvents metrics | Tested | unit (`job-handler.spec.ts`) + integration against local Redis with prefix `hta-test` |
| Workers | Health endpoint `GET /health` on `WORKERS_HEALTH_PORT` (redis/database up or down, per-queue counts, 503 when degraded) | Verified | `curl :4100/health` → 200 against running process; 503 path unit-tested |
| Workers | `email` processor: templates verify_email / password_reset / invitation / notification_digest / generic, `log` and `smtp` drivers | Tested | log driver verified end-to-end (token masked in logs); smtp driver implemented via nodemailer but not exercised (no SMTP server available) |
| Workers | `notifications` processor: writes `Notification` row, idempotent on (`userId`, `data.idempotencyKey`) | Tested | integration test against `hilatech_test` (row created once, redelivery skipped as duplicate) |
| Workers | `analytics` processor: `daily_rollup` counts leads/contacts/conversations per organization for the date and logs them (no rollup table → not persisted); `usage_rollup` not implemented | Tested | integration test; persistence deferred until an analytics table exists |
| Workers | `document-processing`, `embeddings`, `ai-tasks`, `automation`, `webhook-delivery` processors | Not Started | validated + logged, jobs complete with `{ status: 'skipped', reason: 'not_implemented' }` (warn log); real logic belongs to the AI / Knowledge / Automation priorities |

## apps/api — Priority 1 "Working SaaS Foundation" (2026-11-09)

Statuses below reflect what was executed in the bootstrap environment: unit tests (`pnpm --filter @hilatech/api test`, 11 suites / 78 tests),
integration + security tests against `hilatech_test` (`test:integration`, 8 suites / 87 tests), `typecheck`, `lint`, `build`, and a manual
smoke run against the seeded dev database (health, login, Swagger JSON).

| Area | Task | Status | Notes |
| --- | --- | --- | --- |
| API | Bootstrap: env validation (zod, prod placeholder refusal), pino logging + `x-request-id`, helmet/CORS/cookie-parser/body limit/timeouts, `ZodValidationPipe`, `HttpExceptionFilter`, `TransformInterceptor`, Swagger from zod (`/api/docs`), throttling, graceful shutdown | Verified | Swagger disabled in production unless `SWAGGER_ENABLED=true`; request timeout via `REQUEST_TIMEOUT_MS` |
| API | Health: `GET /health`, `GET /health/ready` (Prisma `SELECT 1` + Redis ping) | Verified | terminus; probes keep terminus' native body shape |
| API | PrismaModule (`PrismaService` over `createPrismaClient()`) | Verified |  |
| API | Auth: register (+ invitation token), login, refresh rotation + family revocation on reuse, logout, me, forgot/reset password, verify email, change password, sessions list/revoke | Verified | Argon2id; refresh cookie `hta_refresh` (httpOnly, Lax, path `/api/v1/auth`); every `AuditAction.AUTH_*` written |
| API | Tenancy: `JwtAuthGuard`, `OrganizationGuard`, `PermissionsGuard`, `@Public/@NoTenant/@RequirePermissions/@CurrentUser/@Tenant` | Verified | tenant violations and permission denials audited; cross-tenant suite in `test/security/` |
| API | Organizations: create (roles + owner + free subscription in one tx), list mine, current get/patch/delete (soft, owner only), settings get/put | Verified | slug via `slugify` + random suffix on collision |
| API | Members: list, update (role/status with last-owner + owner-only rules), remove, leave (`DELETE /members/me`) | Verified |  |
| API | Roles & permissions: catalog, CRUD with system-role protections, owner permissions immutable, permission-key validation | Verified | deleting a role removes its historical (non-pending) invitation rows |
| API | Invitations: create (hashed token, email job, seat entitlement), list, revoke, public preview, accept (authenticated, email match) | Verified | raw token only inside the email job payload / log driver |
| API | Users: `GET/PATCH /users/me`, `GET/PUT /users/me/preferences` | Verified | profile/preferences schemas live in the API until added to contracts |
| API | Audit: `AuditService.log`, `GET /audit-logs` (filters + pagination) | Verified |  |
| API | Queue producer (`QueueService.enqueue` validated by `JOB_SCHEMAS`, idempotencyKey = jobId, `BULLMQ_PREFIX`) + `EmailService` (enqueue; inline log driver) | Verified | aligned with workers' template-variable contract (raw `token`, `expiresIn`) |
| API | Billing readiness: subscription, usage summary, plan catalog, `EntitlementsService.assertWithinLimit` (seats enforced on invitations) | Verified | no payment provider; `402 ENTITLEMENT_EXCEEDED` |
| API | Analytics stub: `GET /analytics/dashboard` counts (members, invitations, contacts, leads, conversations) | Verified | live counts only, no placeholder data |
| API | Rate limiting (`RATE_LIMIT_*`, stricter `@AuthThrottle()` on auth endpoints) | Implemented | verified manually (`AUTH_RATE_LIMIT_MAX=2` → third login 429); not covered by automated tests |
