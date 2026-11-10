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

Swagger UI: http://localhost:4000/api/docs · web http://localhost:3000 · API http://localhost:4000/api/v1 · workers health http://localhost:4100/health

If Prisma's engine download is blocked on your network, `pnpm db:migrate:dev` cannot run; use the WebAssembly migration
helper described in [database.md](../architecture/database.md) (`node scripts/prisma-wasm-migrate.mjs apply`).

## Trying the AI features without a provider key

Organization AI credentials are stored in the database (Settings → AI), not in `.env`. For a local walkthrough set
`AI_ALLOW_MOCK_PROVIDER=true` in `.env`, restart the API and add a **mock** provider in Settings → AI; it returns deterministic scripted
output and is refused when `NODE_ENV=production`. With no provider the Assistant and Agents pages show "AI not configured".
Embeddings (knowledge base) also use the mock provider in this mode. Amazon Bedrock needs `AI_BEDROCK_ENABLED=true` and an AWS
identity (`AWS_PROFILE`/`AWS_REGION` or an IAM role); it has never been run against real AWS.
Cost figures appear only if `AI_PRICING_JSON` prices the model.

Email: the default `EMAIL_DRIVER=log` prints messages (tokens masked) in the **workers** log instead of sending them, so invitation and
password-reset links must be copied from there. `EMAIL_DRIVER=smtp` is implemented but untested against a server.

## Useful commands

| Command                                            | What it does                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint` / `pnpm typecheck` / `pnpm test`       | Quality gates across the monorepo                                                                                                                                                    |
| `pnpm test:integration`                            | API integration + security tests (needs DATABASE_URL/REDIS_URL)                                                                                                                      |
| `pnpm --filter @hilatech/web test:e2e`             | Playwright journeys; skipped unless `E2E_BASE_URL` points at a running stack (web + api + workers + Postgres + Redis); `E2E_CHROME_EXECUTABLE` selects a local Chrome. Not run in CI |
| `pnpm --filter @hilatech/workers test:integration` | Workers integration tests (needs DATABASE_URL/REDIS_URL)                                                                                                                             |
| `pnpm build`                                       | Production builds                                                                                                                                                                    |
| `docker compose --profile app up --build`          | Full stack in containers                                                                                                                                                             |

## Environment variables

See `.env.example`; the API validates them on boot (`apps/api/src/config/env.schema.ts`) and the workers validate theirs
(`apps/workers/src/config/env.schema.ts`). In production, placeholder JWT secrets cause startup to fail.

Known inconsistencies in `.env.example` (verified 2026-11-10): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `N8N_WEBHOOK_URL` and `N8N_API_KEY` are listed but
**no code reads them** (provider keys and the n8n URL/key are configured per organization in the UI); `BODY_LIMIT`, `REQUEST_TIMEOUT_MS`,
`WEBHOOK_RATE_LIMIT_MAX` and `SWAGGER_ENABLED` are read by the API but not listed.

## Verified test baseline (2026-11-10)

Unit: api 230, workers 85, ai-engine 84, contracts 38, shared 59, storage 5, web 143, ui 30. Integration (real Postgres + Redis): api 337
(26 suites), workers 46 (4 suites). One of two consecutive full API integration runs reported 10 suites failing to start (no failed tests); a
re-run was green. If you see this, re-run before debugging.

## Deployment

Images are built by `.github/workflows/deploy.yml` on version tags and pushed to GHCR. The deploy
job is disabled until the repository variable `DEPLOY_ENABLED=true` and SSH secrets are set. A
`docker-compose.prod.yml` template lives in `infrastructure/deployment/`. The images have never been built in the authoring environment.
AWS deployment (CDK in `infra/cdk`, `deploy-aws.yml` disabled and approval-gated) is described in
[docs/operations/aws-setup-guide.md](../operations/aws-setup-guide.md); nothing has been deployed.
