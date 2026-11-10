# Architecture Overview

HilaTech AI Assistant is a modular, multi-tenant, AI-powered business platform. This document is the
shared mental model for everyone (human or agent) working in the repository.

## System shape

```
┌──────────────┐   HTTPS/JSON   ┌──────────────────┐    Prisma    ┌──────────────┐
│  apps/web    │ ─────────────► │   apps/api       │ ───────────► │  PostgreSQL  │
│  Next.js     │ ◄───────────── │   NestJS REST    │              │  + pgvector  │
└──────────────┘                │   /api/v1        │              └──────────────┘
                                └────────┬─────────┘
                                         │ BullMQ (Redis)
                                         ▼
                                ┌──────────────────┐    Prisma    ┌──────────────┐
                                │  apps/workers    │ ───────────► │  PostgreSQL  │
                                │  NestJS + BullMQ │              └──────────────┘
                                └──────────────────┘
```

- **apps/web** — Next.js (App Router) SaaS dashboard. Talks only to the API over `/api/v1`.
- **apps/api** — NestJS REST API. Owns all business logic, authorization and tenant isolation.
- **apps/workers** — NestJS standalone application consuming BullMQ queues (documents, embeddings,
  AI tasks, notifications, email, automation, analytics, webhooks).
- **packages/contracts** — zod schemas and TypeScript types shared by all three apps: request/response
  DTOs, permission keys, error codes, queue names and job payloads. _The single source of truth for
  the API surface._
- **packages/database** — Prisma schema, migrations, seed and the generated client. API and workers
  import the client from here so there is exactly one schema.
- **packages/shared** — framework-agnostic utilities (token hashing, slugs, durations, log redaction).
- **packages/types** — pure TypeScript types (TenantContext, Principal, JSON types).
- **packages/ui** — React design-system components used by the web app.
- **packages/config** — shared `tsconfig` and ESLint presets.

## Request lifecycle (API)

1. `RequestIdMiddleware` assigns/propagates `x-request-id`; pino logs carry it.
2. `JwtAuthGuard` validates the access token → `request.principal` (`{ userId, email, sessionId }`).
3. `OrganizationGuard` reads the `x-organization-id` header **as a selector only**, loads the
   caller's active membership for that organization, and attaches `request.tenant`
   (`TenantContext`). Missing/invalid membership → `403 NOT_A_MEMBER`. The header value is never used
   directly in a query without this validation.
4. `PermissionsGuard` enforces `@RequirePermissions(...)` against `tenant.permissions`.
5. Controllers validate bodies/queries with the zod schemas from `@hilatech/contracts`
   (`ZodValidationPipe`), stay thin, and delegate to services.
6. Services receive `TenantContext` explicitly and scope every Prisma query by
   `organizationId`. Repositories/services never accept an `organizationId` from a DTO.
7. `HttpExceptionFilter` maps errors to the standard envelope
   `{ error: { code, message, details?, requestId } }`.
8. Successful responses use `{ data, meta? }` (via `TransformInterceptor`).

## Tenancy model

- Shared database, shared schema. Every organization-owned row has `organizationId`.
- Users may belong to many organizations; a user-scoped access token plus the organization header
  selects the active organization per request. Switching organizations is a client-side change of
  header — no new token required.
- Roles are per organization with system roles (`owner`, `admin`, `member`) created automatically;
  permissions are string keys from `@hilatech/contracts` (`resource:action`).
- Future stronger isolation (schema-per-tenant, RLS) can be added behind the same `TenantContext`
  abstraction without touching controllers. Today isolation is application-enforced only; see [tenant-isolation.md](./tenant-isolation.md) for the mechanisms, tests and known limits.

## Background processing

Producers (API) enqueue jobs whose payloads are validated by the zod schemas in
`@hilatech/contracts/queues`. Every payload carries `organizationId` and an `idempotencyKey`
(used as the BullMQ `jobId` so duplicates collapse). Workers re-validate payloads, run inside the
tenant boundary, use exponential backoff and keep failed jobs for inspection.

## AI engine (Priority 3)

Business services depend on an `AiProvider` interface (generate, stream, structured output, tool
calling, embeddings, usage). Adapters for Anthropic, OpenAI, Amazon Bedrock and a mock provider implement it; a registry selects the
provider from organization configuration. Credentials are encrypted at rest and never returned to
clients. Agents run through an orchestration engine with hard limits (steps, duration, tokens,
delegation depth) and a permission layer in front of every tool call.

## Repository conventions

- TypeScript strict everywhere; ESLint flat config from `@hilatech/config`.
- Tests: Jest for NestJS apps (unit `*.spec.ts`, integration `test/**/*.int-spec.ts`), Vitest for
  packages and the web app, Playwright for end-to-end journeys.
- Commits do not include secrets. `.env.example` documents every variable; the API validates
  required variables at startup and refuses to boot with placeholders in production.
