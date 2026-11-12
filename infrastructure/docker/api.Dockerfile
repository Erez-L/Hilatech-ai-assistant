# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
COPY packages/database/package.json packages/database/
COPY packages/ai-engine/package.json packages/ai-engine/
COPY packages/storage/package.json packages/storage/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @hilatech/api...

FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
# `prisma generate` only needs the variable to exist; no database is contacted at build time,
# and this stage's environment is not carried into the runtime image.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @hilatech/database generate \
 && pnpm --filter @hilatech/api... build \
 && pnpm --filter @hilatech/api deploy --legacy --prod /out \
 # Migration bundle (Prisma CLI + schema + migrations + prisma.config.ts) for the one-off migrate task.
 && pnpm --filter @hilatech/database deploy --legacy /out-migrate

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/* \
 && groupadd -r app && useradd -r -g app app \
 # Local document storage (single-host deployments mount a shared volume here).
 && mkdir -p /data/uploads && chown app:app /data/uploads
WORKDIR /app
COPY --from=build --chown=app:app /out ./
COPY --from=build --chown=app:app /repo/packages/database/prisma ./prisma
# `cd /app/migrate && node node_modules/prisma/build/index.js migrate deploy` applies pending migrations.
COPY --from=build --chown=app:app /out-migrate ./migrate
USER app
EXPOSE 4000
CMD ["node", "dist/main.js"]
