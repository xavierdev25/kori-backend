# syntax=docker/dockerfile:1.7

FROM node:22-slim AS base

ARG PNPM_VERSION=10.33.2
ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && pnpm config set store-dir /pnpm/store

FROM base AS deps

COPY package.json pnpm-lock.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS migrator

ENV NODE_ENV=production

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM deps AS build

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src

RUN pnpm exec prisma generate
RUN pnpm run build

FROM base AS prod-deps

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm dlx prisma@6.19.3 generate
RUN rm -rf node_modules/.pnpm/prisma@* \
    node_modules/.pnpm/@prisma+engines@* \
    node_modules/.pnpm/typescript@* \
    node_modules/.pnpm/effect@* \
    node_modules/.pnpm/fast-check@* \
    && find node_modules -type f \( -name "*.map" -o -name "*.d.ts" \) -delete \
    && find node_modules -xtype l -delete

FROM base AS runner

ENV NODE_ENV=production \
    PORT=4000

COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=prod-deps --chown=node:node /app/prisma ./prisma
COPY --from=prod-deps --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --chmod=755 --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
