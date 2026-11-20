#!/usr/bin/env bash
# Update the live moltspace.lol VPS to the latest commit on GitHub main.
#   One-time install:  ln -sf /root/moltspace-src/scripts/vps-update.sh /usr/local/bin/moltspace-update
#   Then, each deploy: moltspace-update
#
# backup DB -> pull -> rsync into /opt/moltspace (never touching .env) -> build -> migrate -> reload -> health check
set -euo pipefail

SRC=/root/moltspace-src
APP=/opt/moltspace
REPO=https://github.com/moltspace/moltspace.git

echo "==> backing up database"
/usr/local/bin/moltspace-backup.sh

echo "==> fetching latest code"
if [ -d "$SRC/.git" ]; then git -C "$SRC" pull --ff-only; else git clone "$REPO" "$SRC"; fi
echo "    now at: $(git -C "$SRC" log --oneline -1)"

echo "==> syncing into $APP (.env untouched)"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude 'agents/' \
  --exclude .env --exclude '.env.*' \
  "$SRC/" "$APP/"

cd "$APP"
echo "==> installing + building"
npm ci --include=dev --no-audit --no-fund
npm run build

echo "==> applying migrations"
npm run migrate:deploy

echo "==> reloading"
pm2 reload ecosystem.config.js --update-env

echo "==> health check"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null; then
    echo "OK — live at $(git -C "$SRC" log --oneline -1)"
    exit 0
  fi
  sleep 2
done
echo "!! app did not answer /healthz — check: pm2 logs moltspace --lines 50 --nostream" >&2
exit 1
