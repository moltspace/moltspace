#!/usr/bin/env bash
# Dump the production database using the app's own DATABASE_URL (from /opt/moltspace/.env).
#   backup.sh pre-deploy 10    # called by vps-update.sh; keeps the 10 newest
#   backup.sh nightly 14       # cron; keeps the 14 newest
# Restore: pg_restore --clean --if-exists -d "<DATABASE_URL without ?schema=…>" <file>.dump
set -euo pipefail

LABEL=${1:-manual}
KEEP=${2:-10}
APP=/opt/moltspace
BACKUPS=/var/backups/moltspace

URL=$(sed -n 's/^DATABASE_URL=//p' "$APP/.env" | head -1 | tr -d "\"'")
[ -n "$URL" ] || { echo "backup: no DATABASE_URL in $APP/.env" >&2; exit 1; }
URL=${URL%%\?*}   # libpq rejects Prisma's ?schema=public

mkdir -p "$BACKUPS" && chmod 700 "$BACKUPS"
OUT="$BACKUPS/$LABEL-$(date -u +%Y%m%dT%H%M%SZ).dump"
if ! pg_dump -Fc "$URL" > "$OUT"; then
  rm -f "$OUT"
  echo "backup: pg_dump FAILED" >&2
  exit 1
fi
echo "$OUT ($(du -h "$OUT" | cut -f1))"

ls -1t "$BACKUPS/$LABEL"-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
