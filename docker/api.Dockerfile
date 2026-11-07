# API Fastify. Contexto de build: raiz do monorepo.
FROM node:24-bookworm-slim

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/storage/package.json packages/storage/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @leitura/api...

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api

EXPOSE 3000
CMD ["pnpm", "--filter", "@leitura/api", "start"]
