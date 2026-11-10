# System Overview (C4)

Companion to [overview.md](./overview.md) (conventions and request lifecycle). This document is a C4-style
description of what is actually in the repository on 2026-11-10. Dashed boxes are external systems that are **not
verified live**.

## Level 1 — System context

```mermaid
flowchart LR
  staff["Business staff<br/>(owner, admin, member, custom roles)"]
  hook["External systems calling inbound webhooks"]
  sys["HilaTech AI Assistant<br/>multi-tenant SaaS"]
  llm["LLM providers<br/>Anthropic · OpenAI · Amazon Bedrock"]
  smtp["SMTP server"]
  n8n["n8n / customer REST endpoints"]
  s3["Object storage<br/>local disk or S3-compatible"]

  staff -->|"HTTPS, browser"| sys
  hook -->|"POST /api/v1/hooks/:org/:endpoint"| sys
  sys -->|"chat, tools, embeddings"| llm
  sys -->|"system email"| smtp
  sys -->|"http_request, n8n_trigger, outbound webhooks"| n8n
  sys -->|"documents"| s3

  classDef ext stroke-dasharray: 5 5;
  class llm,smtp,n8n,s3 ext;
```

Customers of the tenants (end customers) are **not** users of the system: there is no customer-facing channel, widget or
portal. Conversations and messages are recorded by staff.

External integrations and their verification state: live LLM calls — never made (mock provider only; Bedrock tested
against a mocked SDK); SMTP — `smtp` driver implemented, never exercised; n8n — tested against a local HTTP server;
object storage — local disk verified, S3 driver unit-tested only; WhatsApp / external CRM / payments — not integrated.

## Level 2 — Containers

```mermaid
flowchart TB
  subgraph browser["Browser"]
    web["apps/web<br/>Next.js 15 App Router, React 19, Tailwind 4<br/>@hilatech/ui design system<br/>access token in memory, refresh cookie"]
  end

  subgraph backend["Backend (Node 22)"]
    api["apps/api<br/>NestJS 11 REST /api/v1 + SSE<br/>guards: Throttler, JWT, Organization, Permissions"]
    workers["apps/workers<br/>NestJS standalone, BullMQ consumers<br/>health on :4100"]
  end

  subgraph libs["Shared packages"]
    contracts["packages/contracts<br/>zod schemas, permissions, queue payloads"]
    engine["packages/ai-engine<br/>providers, tools, AgentRunner, RAG"]
    db["packages/database<br/>Prisma 7 schema, migrations, client"]
    storage["packages/storage<br/>StorageDriver (local, S3)"]
    shared["packages/shared<br/>crypto helpers, SSRF guard, utilities"]
  end

  pg[("PostgreSQL 16<br/>+ pgvector, citext")]
  redis[("Redis 7<br/>BullMQ queues, cancellation signal")]
  files[("Object storage")]

  web -->|"HTTPS JSON + SSE<br/>Authorization, x-organization-id"| api
  api --> pg
  api -->|"enqueue validated jobs"| redis
  redis -->|"consume"| workers
  workers --> pg
  api --> files
  workers --> files
  api -.uses.-> engine
  workers -.uses.-> engine
  api -.uses.-> contracts
  workers -.uses.-> contracts
  web -.uses.-> contracts
  engine -.-> db
  api -.-> db
  workers -.-> db
  api -.-> storage
  workers -.-> storage
  api -.-> shared
  workers -.-> shared
```

| Container      | Responsibility                                                                                                                                                                                                                            | Key paths                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/web`     | Dashboard SPA-style app. Route groups: `(marketing)` landing, `(auth)`, `(onboarding)`, `(app)` (authenticated, permission-aware navigation). Talks only to the API.                                                                      | `src/app`, `src/lib/api`, `src/stores/session.ts`   |
| `apps/api`     | All business logic, authorization, tenant isolation, audit, entitlements, budget admission, SSE streaming for the assistant, inbound webhook ingress.                                                                                     | `src/modules/*`, `src/common`, `src/infrastructure` |
| `apps/workers` | Asynchronous work: document extraction/chunking/embedding, async agent executions and conversation summaries, workflow execution and cron scheduling, outbound webhook delivery, email, notification rows, analytics roll-up (logs only). | `src/processors`, `src/automation`, `src/ai`        |
| `packages/*`   | See diagram. `contracts` is the single source of truth for the API surface and queue payloads.                                                                                                                                            |                                                     |

Not deployed as separate containers: there is no separate AI service, vector database, search engine or API gateway.
n8n is an optional external system. `infra/cdk` describes an AWS deployment (ECS Fargate for the three apps, ALB, RDS,
ElastiCache, S3, Secrets Manager, WAF); it has **never been deployed**.

## Level 3 — API components (`apps/api/src/modules`)

```mermaid
flowchart LR
  subgraph edge["Cross-cutting"]
    g["Guards: throttler → JWT → organization → permissions"]
    pipe["ZodValidationPipe · HttpExceptionFilter · TransformInterceptor"]
    audit["AuditService"]
    ent["EntitlementsService + BudgetService"]
    q["QueueService (enqueue)"]
    ev["DomainEventsService"]
  end
  auth["auth · users"]
  org["organizations (members, roles, invitations)"]
  crm["contacts · leads · conversations · notifications"]
  ai["ai: providers · assistant · agents · prompts · tools · usage"]
  kb["knowledge (bases, documents, search)"]
  auto["workflows · webhooks (in/out) · integrations"]
  an["analytics (dashboard, reports, CSV)"]
  bill["billing (plans, usage, budget, checkout 501)"]

  edge --- auth & org & crm & ai & kb & auto & an & bill
  crm --> ev
  ai --> ent
  kb --> ent
  org --> ent
  ev --> q
  kb --> q
  ai --> q
  auto --> q
```

## Level 3 — Worker components (`apps/workers/src`)

| Queue                 | Processor                                                                                                                            | State                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `document-processing` | extract (text/markdown/csv/json/html built in, PDF via `pdf-parse`), chunk, embed, write pgvector, mark `ready`/`failed`, emit event | Verified with mock embeddings                                                                     |
| `embeddings`          | `EmbeddingsProcessor` (stub)                                                                                                         | Completes with `skipped / not_implemented`; embedding currently runs inside `document-processing` |
| `ai-tasks`            | async agent executions, conversation summaries; `lead_enrichment` kind not implemented                                               | Verified with mock provider                                                                       |
| `automation`          | `execute`, `event` fan-out, `resume` (after `delay`), `schedule_tick` (every minute, org time zone)                                  | Verified (scheduler loop itself not exercised)                                                    |
| `webhook-delivery`    | HMAC-signed outbound requests, SSRF guard, 5 attempts with exponential backoff                                                       | Verified                                                                                          |
| `email`               | templates verify_email, password_reset, invitation, notification_digest, generic; drivers `log` (default) and `smtp`                 | `log` verified; `smtp` never exercised                                                            |
| `notifications`       | idempotent `Notification` row write (the API normally writes in-app rows synchronously)                                              | Verified                                                                                          |
| `analytics`           | `daily_rollup` computes and logs counts (no table, not persisted); `usage_rollup` not implemented                                    | Partial                                                                                           |

## Key runtime flows

1. **Request**: browser → `Authorization: Bearer` + `x-organization-id` → guards build `TenantContext` → controller validates with
   zod → service queries with `organizationId` → `{ data, meta }` or `{ error }` envelope. Details in
   [tenant-isolation.md](./tenant-isolation.md).
2. **Assistant message**: `POST /assistant/threads/:id/messages` → entitlement + budget admission → `AgentRunner` (assistant profile) runs in
   the API process → provider stream relayed as SSE → usage and audit rows written.
3. **Document ingestion**: upload → `Document(uploaded)` + object → `document-processing` job → chunks → vectors → `ready` →
   `document.processed` event → searchable via `/knowledge/search` and the `knowledge.search` tool.
4. **Automation**: domain event / cron tick / manual run / inbound webhook → `WorkflowExecution(queued)` →
   `automation.execute` → `WorkflowRunner` steps → step results persisted → notifications, CRM updates, HTTP/n8n calls,
   outbound webhook deliveries.
5. **Async agent run**: `POST /agents/:id/execute` (async) → `AgentExecution(queued)` → `ai-tasks` job → worker resolves the
   user's current permissions → runner with budgets → steps persisted; cancel via `POST /agents/executions/:id/cancel`
   (Redis signal).

## Deployment shapes

| Shape                                                         | Status                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| Local dev: `docker compose up -d postgres redis` + `pnpm dev` | Used for all verification in this repository             |
| `docker compose --profile app up --build` (three app images)  | Defined; images never built in the authoring sandbox     |
| AWS via `infra/cdk` (see `docs/operations/aws-*`)             | `cdk synth` and template assertions only; never deployed |
