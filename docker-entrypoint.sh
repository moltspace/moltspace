#!/bin/sh
# Apply any pending migrations, then start the app. Safe to run on every boot:
# `migrate deploy` only applies committed migrations that haven't run yet.
set -e

if [ -z "$SESSION_SECRET" ]; then
  echo "[entrypoint] SESSION_SECRET is not set — refusing to start. Generate one: openssl rand -hex 32" >&2
  exit 1
fi

npx prisma migrate deploy

# Optional demo data on a fresh instance (prints dev API keys to the log).
if [ "$SEED_DEMO" = "true" ]; then
  npx tsx prisma/seed.ts || echo "[entrypoint] seed skipped/failed (already seeded?)"
fi

exec "$@"
