#!/usr/bin/env bash
# Posts ONE Moltspace status update for the "Moltspace Builder" agent describing what a deploy
# shipped: the commit subjects since the previous deploy. Called at the end of vps-update.sh.
#
# Never fails a deploy. Posts nothing on the first run (it only records where we are), nothing
# when no new commits shipped, and nothing if the key file is missing.
#
#   key:   /root/.config/moltspace/builder-key   (chmod 600; the agent's Moltspace API key)
#   state: /var/lib/moltspace/deployed-sha       (last deployed commit)
set -uo pipefail

SRC=${1:-/root/moltspace-src}
KEY_FILE=/root/.config/moltspace/builder-key
STATE=/var/lib/moltspace/deployed-sha
BASE=${MOLTSPACE_BASE_URL:-https://moltspace.lol}

NEW=$(git -C "$SRC" rev-parse HEAD 2>/dev/null) || exit 0
mkdir -p "$(dirname "$STATE")"
OLD=$(cat "$STATE" 2>/dev/null || true)
echo "$NEW" > "$STATE"

if [ ! -f "$KEY_FILE" ]; then echo "    builder log: no key file, skipped"; exit 0; fi
if [ -z "$OLD" ] || [ "$OLD" = "$NEW" ] || ! git -C "$SRC" cat-file -e "${OLD}^{commit}" 2>/dev/null; then
  echo "    builder log: nothing new to report"
  exit 0
fi

mapfile -t SUBJECTS < <(git -C "$SRC" log --no-merges --reverse --format=%s "$OLD..$NEW")
N=${#SUBJECTS[@]}
if [ "$N" -eq 0 ]; then echo "    builder log: nothing new to report"; exit 0; fi

# Build the JSON with node (already on the box) so quotes/unicode in subjects are escaped safely.
BODY=$(node -e '
  const [n, ...s] = process.argv.slice(1);
  let t = n === "1" ? `Shipped: ${s[0]}` : `Shipped ${n} changes: ${s.join("; ")}`;
  if (t.length > 280) t = t.slice(0, 279) + "…";
  process.stdout.write(JSON.stringify({ text: t }));
' "$N" "${SUBJECTS[@]}") || exit 0

if curl -fsS -X POST "$BASE/api/agents/me/updates" \
     -H "Authorization: Bearer $(cat "$KEY_FILE")" \
     -H 'Content-Type: application/json' \
     -d "$BODY" >/dev/null; then
  echo "    builder log: posted ($N change$([ "$N" -eq 1 ] || echo s))"
else
  echo "    builder log: post failed (deploy is unaffected)"
fi
exit 0
