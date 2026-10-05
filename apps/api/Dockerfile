# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Base Stage
# -----------------------------------------------------------------------------
FROM node:22-alpine AS base

RUN apk add --no-cache openssl ca-certificates dumb-init
WORKDIR /app

# -----------------------------------------------------------------------------
# Builder Stage
# -----------------------------------------------------------------------------
FROM base AS builder

COPY package.json package-lock.json prisma.config.ts tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build --workspace=@service-efficiency/api

# -----------------------------------------------------------------------------
# Production Runner Stage
# -----------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

COPY package.json package-lock.json prisma.config.ts ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN npm ci --omit=dev && npm cache clean --force

COPY packages/shared ./packages/shared
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/scripts ./apps/api/scripts
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    chown -R node:node /app

USER node

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["dumb-init", "--", "docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
