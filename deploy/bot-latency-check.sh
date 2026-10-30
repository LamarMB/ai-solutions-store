#!/usr/bin/env bash
# Диагностика скорости ответа VK-бота на существующем VPS — только чтение.
#
#   sudo bash bot-latency-check.sh [--no-openai]
#
# Печатает без текста сообщений, ключей и полных VK ID:
#  1. службы бота и панели: состояние, перезапуски, память; нагрузка, память и swap сервера;
#  2. журнал бота за 24 ч: подключения и ошибки Long Poll, сбои обработки, коды VK;
#  3. сеть: время ответа api.vk.com, сервера Long Poll и api.openai.com (без ключей);
#  4. счётчики бота за 2 дня (сколько сообщений ушло в OpenAI);
#  5. время обработки событий кодом бота на КОПИИ базы (рабочая не меняется) для
#     вымышленного собеседника: кнопки без модели и одно текстовое сообщение
#     с OpenAI (одно платное обращение; --no-openai — без него).
# ВКонтакте сообщения не отправляются. Копия базы удаляется.
set -Eeuo pipefail
umask 077
APP=${VPS_APP:-/opt/ai-solutions-store}
UNIT_DIR=${VPS_UNIT_DIR:-/etc/systemd/system}
NO_OPENAI=0
[[ ${1:-} == --no-openai ]] && NO_OPENAI=1
[[ $EUID -eq 0 ]] || {
  echo "запустите через sudo"
  exit 1
}
cd "$APP"
TMP=$(mktemp -d /tmp/bot-latency.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
h() { printf '\n== %s\n' "$*"; }

BOT_UNIT=
PANEL_UNIT=
for file in "$UNIT_DIR"/*.service; do
  [[ -f $file ]] && grep -qE "^(WorkingDirectory|ExecStart)=.*${APP}(/| |$)" "$file" || continue
  exec=$(grep -E '^ExecStart=' "$file" | head -1)
  if [[ $exec =~ vk-bot|bot:vk ]]; then BOT_UNIT=$(basename "$file"); elif [[ $exec =~ next|start ]]; then PANEL_UNIT=$(basename "$file"); fi
done
[[ -n $BOT_UNIT ]] || {
  echo "служба бота (ExecStart с vk-bot или bot:vk) в $UNIT_DIR не найдена"
  exit 1
}
NODE=$(command -v node || true)
for unit in "$BOT_UNIT" "$PANEL_UNIT"; do
  [[ -n $unit ]] || continue
  first=$(grep -E '^ExecStart=' "$UNIT_DIR/$unit" 2>/dev/null | head -1 | sed -E 's/^ExecStart=[-@!+:]*//; s/[[:space:]].*//')
  [[ $first == /* && -x $(dirname "$first")/node ]] && NODE=$(dirname "$first")/node
done
[[ -n $NODE ]] || NODE=$(sudo -H -u "$(stat -c %U "$APP")" bash -lc 'command -v node' 2>/dev/null || true)

h "1. Службы и сервер"
echo "код: $(sudo -H -u "$(stat -c %U "$APP")" git -C "$APP" rev-parse --short HEAD), node: $("$NODE" -v)"
for unit in "$BOT_UNIT" "$PANEL_UNIT"; do
  [[ -n $unit ]] || continue
  systemctl show "$unit" -p Id -p ActiveState -p ActiveEnterTimestamp -p NRestarts -p MemoryCurrent -p CPUUsageNSec --no-pager 2>/dev/null | tr '\n' ' ' || true
  echo
done
echo "переменные окружения бота (только имена): $(systemctl show -p Environment --value "$BOT_UNIT" 2>/dev/null | tr ' ' '\n' | sed -E 's/=.*//' | grep -v '^$' | tr '\n' ' ')"
echo "CPU: $(nproc), нагрузка: $(cut -d' ' -f1-3 /proc/loadavg)"
free -m 2>/dev/null | sed 's/^/  /' || true
echo "размер базы: $(du -h .data/bot.sqlite* 2>/dev/null | tr '\n' ' ')"

h "2. Журнал бота за 24 ч (строки без текста сообщений, VK ID замаскированы)"
J="$TMP/journal.txt"
journalctl -u "$BOT_UNIT" --since "-24h" --no-pager -o short-iso >"$J" 2>/dev/null || true
for pattern in "long poll: connected" "long poll: .*retry" "history lost" "handle failed" "обработка события" "event answer failed" "open_app keyboard rejected" "duplicate" "message_new from" "message_event from" "остановка"; do
  printf '  %-28s %s\n' "$pattern" "$(grep -cE "$pattern" "$J" || true)"
done
echo "  последние ошибки и предупреждения:"
grep -E "retry|failed|error|Error|vk [0-9]+|rejected|history lost|FATAL|ECONN|ETIMEDOUT|timeout" "$J" | tail -15 |
  sed -E 's/[0-9]{6,}/<id>/g' | cut -c1-200 | sed 's/^/    /' || true
echo "  запуск бота (настройки без секретов):"
grep -E "OpenAI: " "$J" | tail -1 | sed -E 's/сообщество [0-9]+, //; s/база: [^,]*,//' | cut -c1-400 | sed 's/^/    /' || true

h "3. Сеть (время: соединение / TLS / первый байт / всего, с)"
probe() {
  local name=$1 url=$2 i out
  for i in 1 2 3; do
    if out=$(curl -s -o /dev/null --max-time 20 -w '%{time_connect} / %{time_appconnect} / %{time_starttransfer} / %{time_total} (HTTP %{http_code})' "$url"); then
      echo "  $name: $out"
    else
      echo "  $name: ошибка соединения (curl $?) — $out"
    fi
  done
}
probe api.vk.com "https://api.vk.com/method/utils.getServerTime?v=5.199"
probe lp.vk.com "https://lp.vk.com/"
probe api.openai.com "https://api.openai.com/v1/models"

h "4. Счётчики бота за 2 дня"
(cd "$APP" && "$APP/node_modules/.bin/tsx" --tsconfig "$APP/tsconfig.json" scripts/bot-stats.mts --days=2 2>/dev/null | sed 's/^/  /') || echo "  не удалось прочитать"

h "5. Обработка событий кодом бота на копии базы (вымышленный собеседник)"
"$NODE" --no-warnings -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1], { readOnly: true });
db.exec("PRAGMA busy_timeout = 10000");
db.prepare("VACUUM INTO ?").run(process.argv[2]);' "$APP/.data/bot.sqlite" "$TMP/copy.sqlite"
cat >"$TMP/timing.mts" <<'EOF'
import { createDemoBot, type BotEvent } from "@/bot";
import { loadBotConfig } from "@/bot/config";
import { loadLocalEnv } from "@/bot/env";
loadLocalEnv();
const r = loadBotConfig(process.env);
if (!r.ok) {
  console.log(`  настройки не приняты: ${r.errors.join("; ")}`);
  process.exit(0);
}
const openai = process.argv[3] === "1" ? undefined : r.config.openai;
const { bot, store } = createDemoBot({
  dbPath: process.argv[2],
  openai,
  cipher: r.config.cipher,
  medicalQuestions: r.config.medicalQuestions,
  miniApp: r.config.vk.miniAppId !== undefined,
  demo: r.config.mode === "demo",
  log: () => {},
});
const PEER = 1; // вымышленный собеседник, только в копии базы
const steps: [string, BotEvent][] = [
  ["«Начать»", { type: "start" }],
  ["кнопка «Записаться»", { type: "action", payload: { a: "book" } }],
  ["кнопка «В меню»", { type: "action", payload: { a: "menu" } }],
  ["текст «спасибо» (без модели)", { type: "text", text: "спасибо" }],
  ...(openai
    ? ([["текст для модели (вымышленный)", { type: "text", text: "Хочу записаться к терапевту на этой неделе" }]] as [string, BotEvent][])
    : []),
];
console.log(`  OpenAI: ${openai ? `да, модель ${openai.model}` : "нет (не настроен или --no-openai)"}`);
for (const [name, event] of steps) {
  const t = performance.now();
  const replies = await bot.handle(PEER, event);
  console.log(`  ${name.padEnd(34)} ${Math.round(performance.now() - t)} мс, ответов: ${replies.length}`);
}
store.close();
EOF
(cd "$APP" && "$APP/node_modules/.bin/tsx" --tsconfig "$APP/tsconfig.json" "$TMP/timing.mts" "$TMP/copy.sqlite" "$NO_OPENAI" 2>&1 | grep -v -E "ExperimentalWarning|trace-warnings")
echo
echo "Готово. Рабочая база и службы не менялись; копия базы удалена."
