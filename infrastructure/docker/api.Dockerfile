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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @hilatech/api...

FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @hilatech/database generate \
 && pnpm --filter @hilatech/api... build \
 && pnpm --filter @hilatech/api deploy --prod /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/* \
 && groupadd -r app && useradd -r -g app app
WORKDIR /app
COPY --from=build --chown=app:app /out ./
COPY --from=build --chown=app:app /repo/packages/database/prisma ./prisma
USER app
EXPOSE 4000
CMD ["node", "dist/main.js"]
