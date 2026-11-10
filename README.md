# HilaTech AI Assistant

Modular, multi-tenant, AI-powered business platform: an intelligent operational assistant that
understands a business, talks to its customers, manages leads, executes tasks, automates workflows
and reports insights — built as the foundation of a commercial SaaS product.

## Stack

| Layer      | Technology                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------- |
| Frontend   | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4                               |
| Backend    | NestJS 11, REST under `/api/v1`, Swagger/OpenAPI, zod contracts                             |
| Database   | PostgreSQL 16 + pgvector, Prisma 7 (pg driver adapter)                                      |
| Background | Redis 7, BullMQ 5                                                                           |
| AI         | Provider-independent adapter layer (Anthropic, OpenAI, Amazon Bedrock, mock)                |
| Infra      | Docker, Docker Compose, GitHub Actions, pnpm workspaces + Turborepo, AWS CDK (not deployed) |

## Repository layout

```
apps/
  web/        Next.js SaaS dashboard
  api/        NestJS REST API (business logic, auth, tenancy)
  workers/    BullMQ background workers
packages/
  contracts/  zod schemas, DTO types, permissions, error codes, queue contracts
  database/   Prisma schema, migrations, seed, shared client
  shared/     framework-agnostic utilities
  types/      pure TypeScript types
  ui/         design-system components and tokens
  ai-engine/  providers, tools, agent runner, RAG helpers
  storage/    object-storage drivers (local disk, S3-compatible)
  config/     shared tsconfig / eslint presets
infrastructure/ docker, deployment, monitoring
infra/cdk/      AWS CDK v2 app (synth-validated only; never deployed)
docs/           product, design, architecture, api, security, development, operations
```

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres redis
pnpm db:generate && pnpm db:migrate:dev
SEED_DEMO=true pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000 · API: http://localhost:4000/api/v1 · Swagger: http://localhost:4000/api/docs
- Demo login (development only): `owner@demo.local` / `DemoPassw0rd!`

Full instructions: [docs/development/setup.md](docs/development/setup.md).

## Current status (2026-11-10)

Built and tested: authentication and multi-tenancy, roles/permissions, CRM (contacts, leads, conversations), notifications,
AI assistant and agents, knowledge base with RAG, workflows and webhooks, integration framework (REST, n8n), analytics,
billing readiness (plans, entitlements, AI budget), audit log. **AI behaviour has only been verified with the mock provider**; no
live LLM, SMTP, n8n, WhatsApp, payment or AWS call has ever been made, and Docker images and the CDK stacks have never been built or deployed.
Not built: customer-facing channels, deals/tasks/Kanban, CSV import/export, Hebrew/RTL, payments, MFA, evaluation datasets.
Details: [Feature matrix](docs/product/feature-matrix.md) · [Gap analysis](docs/development/gap-analysis.md) · [Task status](docs/development/task-status.md).

## Documentation

- Product: [Vision](docs/product/product-vision.md) · [Functional specification](docs/product/functional-specification.md) · [User journeys](docs/product/user-journeys.md) · [Feature matrix](docs/product/feature-matrix.md)
- Design: [Design system](docs/design/design-system.md) · [Screen specifications](docs/design/screen-specifications.md)

- Architecture: [System overview (C4)](docs/architecture/system-overview.md) · [Overview and conventions](docs/architecture/overview.md) · [Tenant isolation](docs/architecture/tenant-isolation.md) · [AI engine](docs/architecture/ai-engine.md) · [Knowledge and automation](docs/architecture/knowledge-and-automation.md) · [Decisions](docs/architecture/decisions.md) · [Database](docs/architecture/database.md)
- [Security model](docs/security/security-model.md) · [API overview](docs/api/api-overview.md)
- Development: [Setup](docs/development/setup.md) · [Roadmap](docs/development/roadmap.md) · [Implementation plan](docs/development/implementation-plan.md) · [Gap analysis](docs/development/gap-analysis.md) · [Task status](docs/development/task-status.md)
- Operations and AWS: `docs/operations/` ([runbooks](docs/operations/runbooks.md), [SLOs](docs/operations/slos.md), [backup and recovery](docs/operations/backup-recovery.md), [AWS setup guide](docs/operations/aws-setup-guide.md))

## Quality gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:integration` · `pnpm build` run in CI. Playwright journeys
(`pnpm --filter @hilatech/web test:e2e`, needs a running stack and `E2E_BASE_URL`) do **not** run in CI.

Last local run (2026-11-10): API 230 unit + 337 integration tests, workers 85 unit + 46 integration, ai-engine 84, contracts 38,
shared 59, storage 5, web 143, ui 30 — all passing.

## License

Proprietary — © HilaTech Dev. All rights reserved.
