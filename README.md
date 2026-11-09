# HilaTech AI Assistant

Modular, multi-tenant, AI-powered business platform: an intelligent operational assistant that
understands a business, talks to its customers, manages leads, executes tasks, automates workflows
and reports insights — built as the foundation of a commercial SaaS product.

## Stack

| Layer      | Technology                                                          |
| ---------- | ------------------------------------------------------------------- |
| Frontend   | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4       |
| Backend    | NestJS 11, REST under `/api/v1`, Swagger/OpenAPI, zod contracts     |
| Database   | PostgreSQL 16 + pgvector, Prisma 7 (pg driver adapter)              |
| Background | Redis 7, BullMQ 5                                                   |
| AI         | Provider-independent adapter layer (Anthropic Claude, OpenAI)       |
| Infra      | Docker, Docker Compose, GitHub Actions, pnpm workspaces + Turborepo |

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
  ui/         design-system components
  config/     shared tsconfig / eslint presets
infrastructure/ docker, deployment, monitoring
docs/           architecture, api, security, development
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

## Documentation

- [Architecture overview](docs/architecture/overview.md) · [Decisions](docs/architecture/decisions.md) · [Database](docs/architecture/database.md)
- [Security model](docs/security/security-model.md)
- [API overview](docs/api/api-overview.md)
- [Roadmap](docs/development/roadmap.md) · [Task status](docs/development/task-status.md)

## Quality gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:integration` · `pnpm build` — all run in CI.

## License

Proprietary — © HilaTech Dev. All rights reserved.
