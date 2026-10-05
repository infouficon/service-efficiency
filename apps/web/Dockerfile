# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Builder Stage
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN npm run build --workspace=@service-efficiency/web

# -----------------------------------------------------------------------------
# Production Runner Stage
# -----------------------------------------------------------------------------
FROM nginx:alpine AS runner

ENV API_URL=http://api:3001

COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
