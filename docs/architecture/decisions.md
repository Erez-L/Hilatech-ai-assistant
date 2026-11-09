# Architecture Decision Records

Short, dated records of decisions that shape the codebase. Add new entries at the bottom.

## ADR-001 — Monorepo with pnpm workspaces + Turborepo (2026-11-09)

Accepted. One repository, independently deployable apps (`web`, `api`, `workers`), shared packages
only where they remove duplication (contracts, database, shared, types, ui, config).

## ADR-002 — Pin to proven major versions (2026-11-09)

Accepted. The registry currently offers Next 16, NestJS 12, Prisma 8-rc, TypeScript 7 (native
port) and zod 4. We pin **Next 15.5, NestJS 11, Prisma 7.10, TypeScript 5.9, zod 3.25, BullMQ 5,
Tailwind 4** because: TypeScript 7 does not yet support `emitDecoratorMetadata`, which NestJS DI
requires; Prisma 8 is a release candidate; zod 4 changes the error/issue API and several schema
helpers. Prisma 7 (GA) is used rather than 6 because its client is Rust-free (driver adapters, no
engine download at runtime), which matters for container images and restricted networks. All chosen
versions are maintained and documented. Upgrades are tracked in `docs/development/roadmap.md`.

## ADR-003 — Shared Prisma client in `packages/database` (2026-11-09)

Accepted. The spec's suggested layout has no database package; we add one because API and workers
must share one schema and one generated client. Prisma 7's `prisma-client` generator emits TypeScript
into `packages/database/src/generated` (git-ignored, produced by `pnpm db:generate`); the package
compiles it and exports `PrismaClient`, `Prisma`, model types and a `createPrismaClient()` factory
that wires the `pg` driver adapter.

## ADR-003b — Migrations without the native schema engine (2026-11-09)

Accepted. The Prisma CLI downloads a native `schema-engine` binary from `binaries.prisma.sh`, which
some networks block (it was blocked in the environment where this repository was bootstrapped).
`scripts/prisma-wasm-migrate.mjs` drives the same engine compiled to WebAssembly
(`@prisma/schema-engine-wasm`, pinned to the engine commit of the installed `prisma` version) through
the pg adapter. It produces identical SQL and records history in `_prisma_migrations`, so `prisma
migrate deploy` on normal networks and the script are interchangeable. Normal environments should use
the Prisma CLI (`pnpm db:migrate:dev`).

## ADR-004 — Tenant selection via header, validated against membership (2026-11-09)

Accepted. Access tokens are user-scoped. The client sends `x-organization-id` to select the active
organization; `OrganizationGuard` loads the caller's membership and builds `TenantContext`. The raw
header value is never used in a query. Services take `TenantContext` explicitly (no request-scoped
providers) for testability and performance.

## ADR-005 — Refresh tokens: opaque, hashed, rotated, family-revoked (2026-11-09)

Accepted. Access JWT (15 min) lives in memory in the browser. Refresh token is opaque (48 random
bytes), stored as SHA-256, delivered as an `httpOnly; Secure; SameSite=Lax` cookie scoped to
`/api/v1/auth`. Each refresh rotates the token; presenting an already-rotated token revokes the whole
family (session) and is audited. No tokens in `localStorage`.

## ADR-006 — Permission vocabulary in code, roles in the database (2026-11-09)

Accepted. Permission keys (`resource:action`) are defined in `@hilatech/contracts` and mirrored into
the `Permission` catalog table by the seed. Roles are per-organization rows holding `permissions:
String[]`, validated against the catalog. System roles are created with each organization and cannot
be deleted; the `owner` role's permissions cannot be reduced.

## ADR-007 — Validation with zod shared contracts instead of class-validator (2026-11-09)

Accepted. The spec asks for DTO validation; we implement it with a `ZodValidationPipe` using the
schemas in `@hilatech/contracts`, so the frontend forms, the API and the workers validate with the
same definitions. Swagger documentation is generated from the zod schemas via `zod-to-openapi`-style
helpers inside the API (`src/common/openapi`).

## ADR-008 — Email, storage and AI providers behind drivers (2026-11-09)

Accepted. `EMAIL_DRIVER=log|smtp`, `STORAGE_DRIVER=local|s3`, AI providers via adapter registry.
Local development works with no external credentials; production features switch on by
configuration. Nothing pretends to be live when a driver is unconfigured.

## ADR-009 — AI engine as a shared package with ports for persistence (2026-11-09)

Accepted. `packages/ai-engine` holds the provider adapters, context builder, tool registry/executor
and the agent runner, with **no** NestJS or Prisma-model dependencies beyond the Prisma client type
used by tools. Persistence (`AgentExecution`, steps, `AiRequestLog`) goes through two ports
(`ExecutionStore`, `UsageRecorder`) implemented by the API and the workers. Reason: the interactive
assistant (API) and asynchronous agent runs (workers) must execute identical logic, and the engine
must be unit-testable with the deterministic `MockProvider` and no database.

## ADR-010 — Tool permission layer: least privilege, no autonomous dangerous actions (2026-11-09)

Accepted. Every tool declares a `riskLevel` (`read` | `write` | `dangerous`) and a required
`Permission`. The executor checks allow-list → permission → write grant → input schema → timeout.
The effective permission set of an agent is the triggering user's permissions when a human
triggered the run (an agent never exceeds the human it acts for); for automation/schedule triggers it
is the permissions implied by the admin-configured tool list. `dangerous` tools are never executed
without explicit human authorization (they return `requires_authorization`). Tool results and
documents are wrapped in `<data>` blocks and the system prompt marks them as untrusted data.

## ADR-011 — Agent execution model: async by default, bounded budgets shared across delegation (2026-11-09)

Accepted. `POST /agents/:id/execute` enqueues on `ai-tasks` and the workers run it; `mode: 'sync'` is a
capped interactive path. A single `Budget` (deadline, tokens, delegations) is shared by reference
through the whole delegation tree so children can never exceed the root's limits; delegation depth is
capped at 2, cycles are rejected by checking the agent ancestry, and children receive only the
delegated task plus an explicit context object — never the parent's full transcript.

## ADR-012 — Cost estimates only from configured pricing (2026-11-09)

Accepted. The engine ships no model prices. `AI_PRICING_JSON` may supply USD-per-million-token
rates; when a model is missing from it, `estimatedCostUsd` is `null` on request logs, executions and
usage summaries (a summary is `null` if any request in it lacks pricing). Token counts are always
recorded from provider responses.

## ADR-013 — One embedding dimension for all tenants (2026-11-09)

Accepted. `DocumentChunk.embedding` is `vector(1536)` with a single HNSW cosine index. Providers that
support native shrinking (`text-embedding-3-*`) are asked for 1536 dimensions; smaller vectors are
zero-padded, larger ones truncated with a warning. Reason: pgvector indexes need a fixed dimension,
and a per-knowledge-base dimension would mean per-tenant tables/indexes — more complexity than the
small quality cost of padding for a shared-schema SaaS.

## ADR-014 — Object storage behind `@hilatech/storage` (2026-11-09)

Accepted. Uploaded documents never live in PostgreSQL. `StorageDriver` (local disk for development,
S3-compatible for production, SDK loaded lazily) with tenant-scoped keys and strict key validation.
Downloads go through authenticated API endpoints that check the tenant.

## ADR-015 — Workflows as data, executed by the workers (2026-11-09)

Accepted. `Workflow.trigger`/`steps` are JSON validated by the contracts' discriminated unions; the
API only validates, stores and enqueues; the workers run steps, persist `stepResults`, and handle
delays by re-enqueueing a `resume` job. Domain events are emitted by the API as `automation.event`
jobs and fanned out by the workers to workflows and outbound webhooks, so emitting an event never
slows a request and the core does not depend on n8n.

## ADR-016 — Amazon Bedrock as a provider, not as the orchestrator (2026-11-10)

Accepted. Bedrock is added as `AiProviderKind` `bedrock` (Converse/ConverseStream/InvokeModel through
`@aws-sdk/client-bedrock-runtime`), authenticated only by the AWS default credential chain (task role in AWS, SSO
profile locally) — no API key is stored. `AgentRunner` remains the only orchestrator; AgentCore Runtime/Gateway are
documented as optional future backends behind an interface (`docs/architecture/agentcore-integration.md`).
Because Bedrock calls use the _server's_ identity and bill the platform's AWS account, creating Bedrock provider
configs is gated by `AI_BEDROCK_ENABLED` (default false) and a tenant-supplied endpoint override is ignored.
`AiProviderConfig.region` (nullable) was added with an additive migration. Unit-tested against a mocked SDK client
only; never exercised against live Bedrock.

## ADR-017 — Keep pgvector; do not adopt Bedrock Knowledge Bases (2026-11-10)

Accepted. Knowledge Bases would add Aurora PostgreSQL / OpenSearch / S3 Vectors (plain RDS PostgreSQL is not a
listed store), a new tenant-isolation model, and AWS lock-in, without a capability we lack today. Embeddings still
come from Bedrock (Titan/Cohere) through the provider adapter. Revisit if enterprise connectors (SharePoint,
Confluence, Drive) with document-level ACLs become a requirement. Details: `docs/architecture/aws-capability-matrix.md`.

## ADR-018 — AWS infrastructure as CDK v2 (TypeScript), standalone project (2026-11-10)

Accepted. `infra/cdk` is a standalone npm project (not part of the pnpm workspace) so CDK's dependency tree and
Node tooling do not affect the app builds. Stateful and stateless resources are in separate stacks; cdk-nag
(AwsSolutions) is enforced in synth with reasoned acknowledgements. CI only synthesises and tests; deployment is a
manual, approval-gated, OIDC-based workflow that is disabled by default. BullMQ stays on Redis (SQS migration path
documented, not built).
