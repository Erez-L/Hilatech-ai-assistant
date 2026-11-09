# Development Setup

## Prerequisites

- Node.js 22+, pnpm 10+ (`corepack enable`)
- Docker (for Postgres + Redis) — or local PostgreSQL 16 with `pgvector`/`citext` and Redis 7

## First run

```bash
cp .env.example .env            # adjust secrets (openssl rand -base64 48)
pnpm install
docker compose up -d postgres redis
pnpm db:generate
pnpm db:migrate:dev             # applies migrations (creates DB objects)
SEED_DEMO=true pnpm db:seed     # permission catalog + demo org (owner@demo.local / DemoPassw0rd!)
pnpm dev                        # web :3000, api :4000, workers :4100 (health)
```

Swagger UI: http://localhost:4000/api/docs

## Useful commands

| Command                                      | What it does                                                    |
| -------------------------------------------- | --------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates across the monorepo                               |
| `pnpm test:integration`                      | API integration + security tests (needs DATABASE_URL/REDIS_URL) |
| `pnpm --filter @hilatech/web test:e2e`       | Playwright journeys (needs running stack)                       |
| `pnpm build`                                 | Production builds                                               |
| `docker compose --profile app up --build`    | Full stack in containers                                        |

## Environment variables

See `.env.example`; the API validates them on boot (`apps/api/src/config/env.schema.ts`). In
production, placeholder JWT secrets cause startup to fail.

## Deployment

Images are built by `.github/workflows/deploy.yml` on version tags and pushed to GHCR. The deploy
job is disabled until the repository variable `DEPLOY_ENABLED=true` and SSH secrets are set. A
`docker-compose.prod.yml` template lives in `infrastructure/deployment/`.
