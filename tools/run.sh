#!/usr/bin/env bash
# Выполняется в каталоге приложения (ветка из tools/target).
set -uo pipefail
OUT="$GITHUB_WORKSPACE/out"; T="$GITHUB_WORKSPACE/tools-src/tools"
mkdir -p "$OUT/shots"
echo "target: $TARGET $(git rev-parse --short HEAD)" > "$OUT/summary.txt"
step() { local name=$1; shift; if "$@" > "$OUT/$name.log" 2>&1; then echo "$name: OK" >> "$OUT/summary.txt"; else echo "$name: FAIL" >> "$OUT/summary.txt"; fi; }
step ci npm ci --no-audit --no-fund
npx prettier --write . > /dev/null 2>&1; git diff > "$OUT/format.patch"; git diff --stat >> "$OUT/summary.txt"
step lint npm run lint
step typecheck npm run typecheck
step test npm test
step build npm run build
cp "$T/transcripts.mts" scripts/_transcripts.mts && npx tsx scripts/_transcripts.mts > "$OUT/transcripts.json" 2> "$OUT/transcripts.err"; rm -f scripts/_transcripts.mts
grep -qx 'build: OK' "$OUT/summary.txt" || exit 0
[ -f "$T/shots.mjs" ] || exit 0

# Демо-стенд: временная база с вымышленной клиникой.
export BOT_DB_PATH=/tmp/demo/bot.sqlite MEDICAL_DATA_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export VK_MINIAPP_ID=51000001 VK_MINIAPP_SECRET=demo-secret-0123456789 MINIAPP_ALLOWED_USER_IDS=900100 VK_ALLOWED_USER_IDS=900100 ADMIN_COOKIE_SECURE=false
export DEMO_PASSWORD=demo-$(openssl rand -hex 8)
mkdir -p /tmp/demo
cp "$T/seed.mts" scripts/_seed.mts
step seed npx tsx scripts/_seed.mts
rm -f scripts/_seed.mts
(npx next start -H 127.0.0.1 -p 3100 > "$OUT/next.log" 2>&1 &)
# Отметка «бот работает» для главной панели (демо-стенд без ВКонтакте).
(while true; do node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.BOT_DB_PATH);const t=new Date().toISOString();d.prepare('UPDATE bot_status SET value=?, updated_at=? WHERE key=?').run(t,t,'last_poll_at')" 2>/dev/null; sleep 20; done &)
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:3100/ && break; sleep 1; done
mkdir -p /tmp/pw && (cd /tmp/pw && npm init -y >/dev/null && npm i --no-audit --no-fund playwright@1.56.1 > "$OUT/pw-install.log" 2>&1 && npx playwright install --with-deps chromium >> "$OUT/pw-install.log" 2>&1)
cp "$T/shots.mjs" "$T/steps.mjs" /tmp/pw/
APP_DIR=$PWD step shots node /tmp/pw/shots.mjs
