# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json ./
COPY apps/workers/package.json apps/workers/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
COPY packages/database/package.json packages/database/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @hilatech/workers...

FROM deps AS build
COPY packages ./packages
COPY apps/workers ./apps/workers
RUN pnpm --filter @hilatech/database generate \
 && pnpm --filter @hilatech/workers... build \
 && pnpm --filter @hilatech/workers deploy --prod /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/* \
 && groupadd -r app && useradd -r -g app app
WORKDIR /app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 4100
CMD ["node", "dist/main.js"]
