# Contributing & Engineering Conventions

This file is the working agreement for everyone (people and coding agents) changing this repository.
Read `docs/architecture/overview.md` first.

## Ground rules

1. **Inspect before modifying; never overwrite files blindly.** Preserve useful existing work.
2. **One codebase, one architecture.** Shared shapes live in `@hilatech/contracts`; do not redefine
   request/response types locally. If a contract is missing, add it to the package (and its test).
3. **Nothing fake presented as real.** Mocks only in tests or in explicitly labeled development
   drivers (`EMAIL_DRIVER=log`). Features that are not implemented return `501 NOT_IMPLEMENTED`-style
   clear responses or are not exposed; the UI shows "coming soon" states, never static mock data.
4. **Never claim a test passed unless you ran it.** Report exactly what was executed.
5. **Security defaults:** no secrets in code/logs/responses; validate all input with zod; scope every
   tenant query by `organizationId` taken from `TenantContext`, never from a DTO or raw header.
6. **Migrations only via Prisma migrations** (`packages/database/prisma/migrations`). The schema for
   Priorities 1–2 is complete; do not edit `schema.prisma` without an architectural reason, and if
   you do, create a migration (see `docs/architecture/database.md`).
7. Keep controllers thin, services testable (explicit dependencies, no request-scoped providers),
   modules independent, and document significant decisions in `docs/architecture/decisions.md`.

## Versions (pinned — see ADR-002)

Next 15.5 · React 19 · NestJS 11 · Prisma 7.10 (pg adapter) · TypeScript 5.9 · zod 3.25 · BullMQ 5 ·
ioredis 5 · Tailwind 4 · Jest 29 (Nest apps) · Vitest 3 (packages, web) · Playwright 1.65 · ESLint 9.
Install exact versions (`pnpm add pkg@x.y.z`), check `npm view <pkg>@<major> version` for the latest
patch in the pinned major.

## Repository mechanics

- Package manager: pnpm 10 workspaces; task runner: Turborepo. Run from repo root:
  `pnpm --filter @hilatech/api <script>` or `pnpm -r <script>`.
- Environment: `.env` at repo root (copy from `.env.example`). Nest apps load `['.env', '../../.env']`.
  Shell usage: `set -a; . ./.env; set +a`.
- Database: `pnpm db:generate` after any schema change; the generated client is in
  `packages/database/src/generated` (git-ignored) and consumed only through `@hilatech/database`.
- Local services in the bootstrap environment: PostgreSQL 16 (`postgresql://postgres:postgres@localhost:5432/hilatech`
  for dev with demo seed, `.../hilatech_test` for integration tests) and Redis (`redis://localhost:6379`).
- Integration tests must use `hilatech_test` and clean up what they create (or truncate between suites).

## API conventions (apps/api)

- Global prefix `/api/v1` (`API_PREFIX` from contracts). Swagger at `/api/docs`.
- Success envelope `{ data, meta? }` via `TransformInterceptor`; error envelope
  `{ error: { code, message, details?, requestId } }` via `HttpExceptionFilter`; codes from
  `ErrorCode` in contracts. Validation errors → 400 `VALIDATION_ERROR` with zod issues in `details`.
- Validation: `ZodValidationPipe(schema)` on `@Body()` / `@Query()` using contract schemas.
- Guards (global order): `JwtAuthGuard` (skippable via `@Public()`), `OrganizationGuard`
  (skippable via `@NoTenant()` for user-scoped endpoints such as `/auth/*`, `/users/me`,
  `GET/POST /organizations`), `PermissionsGuard` (`@RequirePermissions(Permission.X, ...)`).
- Decorators: `@CurrentUser()` → `Principal`; `@Tenant()` → `TenantContext`.
- Tenant selection header: `x-organization-id` (`ORGANIZATION_HEADER`). Missing header on a
  tenant-scoped route → 400 `ORGANIZATION_REQUIRED`; not a member/suspended → 403 `NOT_A_MEMBER`
  (+ audit `security.tenant_violation_attempt`).
- Auth: Argon2id; access JWT (`JWT_ACCESS_TTL`, claims `AccessTokenClaims`); refresh token opaque,
  SHA-256 at rest, cookie `hta_refresh` (`httpOnly`, `SameSite=Lax`, `Secure` when
  `COOKIE_SECURE=true`, `path=/api/v1/auth`), rotation + family revocation on reuse.
- Pagination: `paginationQuerySchema`; respond with `meta: PaginationMeta`.
- Logging: nestjs-pino with `x-request-id`, redaction from `SENSITIVE_LOG_PATHS`.
- Audit: `AuditService.log({ action, organizationId?, actorUserId?, targetType?, targetId?, metadata?, request })`.
- Queues: produce jobs with `QueueService.enqueue(QueueName.X, payload)` which validates the payload
  with `JOB_SCHEMAS[X]` and uses `idempotencyKey` as the BullMQ `jobId`.

## Web conventions (apps/web, packages/ui)

- Next.js App Router, TypeScript strict, Tailwind 4 (`@import "tailwindcss"` + `@theme` tokens in
  `packages/ui/src/styles.css`), components in `packages/ui` (Button, Input, Card, Table, Modal,
  Dropdown, Sidebar, Nav, Toast, StatusBadge, Skeleton, EmptyState, ErrorState, Charts).
- Data layer: `@tanstack/react-query`; forms: `react-hook-form` + `@hookform/resolvers/zod` with
  contract schemas; state: `zustand` only for session (access token in memory, active organization).
- API client (`src/lib/api/client.ts`): base `NEXT_PUBLIC_API_URL + /api/v1`, `credentials: 'include'`,
  attaches `Authorization` and `x-organization-id`, on 401 attempts one `POST /auth/refresh` then
  retries, surfaces `ApiError` shapes to the UI.
- Route groups: `(marketing)` landing · `(auth)` login/register/forgot/reset/invite ·
  `(app)` everything behind auth with sidebar layout and an organization switcher.
- Every data screen implements loading, empty, error and success states. No static mock data.

## Workers conventions (apps/workers)

- NestJS standalone application context; one BullMQ `Worker` per queue in `QueueName`, payloads
  re-validated with `JOB_SCHEMAS`; concurrency and retry from `DEFAULT_JOB_OPTIONS`; structured pino
  logs with `jobId`, `queue`, `organizationId`; health endpoint on `WORKERS_HEALTH_PORT` (default 4100)
  reporting Redis/DB connectivity and per-queue counts.

## Testing

- Nest apps: Jest 29 + `@swc/jest`; unit tests `src/**/*.spec.ts`; integration
  `test/**/*.int-spec.ts` (supertest against the real app + `hilatech_test`); security tests live in
  `test/security/`.
- Packages and web: Vitest 3 (+ Testing Library for components).
- E2E: Playwright in `apps/web/e2e` against a running stack.
- Scripts every app exposes: `dev`, `build`, `start`, `lint`, `typecheck`, `test`,
  `test:integration` (may be a no-op echo where not applicable), `clean`.

## Documentation to keep in sync

`docs/development/task-status.md` (statuses: Not Started · In Progress · Blocked · Implemented ·
Tested · Verified), `docs/api/api-overview.md`, `docs/architecture/decisions.md`, `CHANGELOG.md`.
