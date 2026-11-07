# Worker com Calibre (ebook-convert). Contexto de build: raiz do monorepo.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends calibre \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/storage/package.json packages/storage/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @leitura/worker...

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/worker apps/worker

ENV CALIBRE_BIN=ebook-convert
CMD ["pnpm", "--filter", "@leitura/worker", "start"]
