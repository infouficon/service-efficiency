#!/bin/sh
set -e

echo "[Entrypoint] Running database migrations..."
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma

if [ -n "$BOOTSTRAP_STAFF_ID" ] && [ -n "$BOOTSTRAP_PASSWORD" ]; then
  echo "[Entrypoint] Running initial database bootstrap..."
  node apps/api/scripts/bootstrap.mjs || echo "[Entrypoint] Bootstrap completed or skipped."
fi

echo "[Entrypoint] Starting application server..."
exec "$@"
