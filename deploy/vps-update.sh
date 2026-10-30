#!/usr/bin/env bash
# Обновление существующего VPS «Демо-Мед»: одно приложение в /opt/ai-solutions-store,
# службы systemd бота и панели, база SQLite (WAL). Порядок и откат — docs/vps-update.md.
# Не для экземпляров клиник из deploy/clinic (там new-clinic.sh).
#
#   sudo bash vps-update.sh update   <коммит> [<текущий коммит>]   обновить
#   sudo bash vps-update.sh rollback <каталог отката>               вернуть прежний код
#
# update: проверки без изменений → копии конфигурации, кода и базы (VACUUM INTO) →
# остановка служб → согласованная копия базы и проверка её восстановления →
# git checkout, npm ci, build → проверка настроек бота новым кодом и неизменности
# базы → запуск → бот, панель, Mini App, адреса nginx. Сбой после остановки служб —
# автоматический откат кода. Рабочая база не пересоздаётся, не восстанавливается из
# копии автоматически, миграции не выполняются (обновление без изменений схемы).
# Секреты не выводятся. Журнал — /root/demo-med-backups/<время>/update.log.
set -Eeuo pipefail
umask 077

APP=${VPS_APP:-/opt/ai-solutions-store}
BACKUPS=${VPS_BACKUPS:-/root/demo-med-backups}
UNIT_DIR=${VPS_UNIT_DIR:-/etc/systemd/system}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BK="$BACKUPS/$STAMP"
PATHS=(/ /admin/login /miniapp /api/miniapp/clinic /robots.txt)
PHASE=check
ROLLBACK_DIR=
ROLLING=
TOOLS=
BASE_SHORT=?

say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
# Остановка. После остановки служб — через откат, а не с остановленными службами.
die() {
  say "СТОП: $*"
  case $PHASE in
  stopped | updated | started) [[ -n $ROLLING ]] || rollback_now 1 ;;
  esac
  exit 1
}

[[ $EUID -eq 0 ]] || {
  echo "запустите через sudo"
  exit 1
}
mkdir -p "$BACKUPS" "$BK"
chmod 700 "$BACKUPS" "$BK"
exec > >(tee -a "$BK/update.log") 2>&1
exec 9>"$BACKUPS/.lock"
flock -n 9 || die "уже выполняется другое обновление"
cp "${BASH_SOURCE[0]}" "$BK/vps-update.sh"

MODE=${1:-}
[[ -d $APP/.git ]] || die "$APP — не репозиторий Git"
cd "$APP"
OWNER=$(stat -c %U "$APP")

# --- Службы: юниты systemd, которые запускают код из $APP -------------------------
BOT_UNIT=
PANEL_UNIT=
detect_units() {
  local file unit exec
  for file in "$UNIT_DIR"/*.service; do
    [[ -f $file ]] || continue
    grep -qE "^(WorkingDirectory|ExecStart)=.*${APP}(/| |$)" "$file" || continue
    unit=$(basename "$file")
    exec=$(grep -E '^ExecStart=' "$file" | head -1)
    if [[ $exec =~ vk-bot|bot:vk ]]; then
      [[ -z $BOT_UNIT ]] || die "две службы бота: $BOT_UNIT и $unit"
      BOT_UNIT=$unit
    elif [[ $exec =~ next|npm[[:space:]]+(run[[:space:]]+)?start ]]; then
      [[ -z $PANEL_UNIT ]] || die "две службы панели: $PANEL_UNIT и $unit"
      PANEL_UNIT=$unit
    else
      die "служба $unit запускает код из $APP, но не распознана — обновите вручную"
    fi
  done
  [[ -n $BOT_UNIT && -n $PANEL_UNIT ]] ||
    die "не найдены службы бота и панели в $UNIT_DIR (бот: ${BOT_UNIT:-нет}, панель: ${PANEL_UNIT:-нет}); pm2 и другие способы запуска скрипт не обслуживает"
}

unit_env() { systemctl show -p Environment --value "$1" 2>/dev/null || true; }
unit_env_files() {
  sed -nE 's/^EnvironmentFile=-?(.*)$/\1/p' "$UNIT_DIR/$1" "$UNIT_DIR/$1.d"/*.conf 2>/dev/null || true
}
file_value() {
  [[ -r $1 ]] || return 0
  sed -nE "s/^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=[[:space:]]*['\"]?([^'\"#]*)['\"]?.*$/\2/p" "$1" |
    tail -1 | sed -E 's/[[:space:]]+$//'
}
# Значение переменной для службы так, как его увидит приложение: окружение юнита и
# EnvironmentFile важнее .env.local (loadLocalEnv не переопределяет). Не выводится.
cfg_value() {
  local unit=$1 key=$2 value file
  value=$(unit_env "$unit" | tr ' ' '\n' | sed -nE "s/^$key=(.*)$/\1/p" | tail -1)
  [[ -n $value ]] && {
    echo "$value"
    return
  }
  while read -r file; do
    [[ -n $file ]] && value=$(file_value "$file" "$key") && [[ -n $value ]] && {
      echo "$value"
      return
    }
  done < <(unit_env_files "$unit" | tac)
  file_value "$APP/.env.local" "$key"
}

panel_port() {
  local exec env
  exec=$(grep -E '^ExecStart=' "$UNIT_DIR/$PANEL_UNIT" | head -1)
  if [[ $exec =~ (-p|--port)[=[:space:]]+([0-9]+) ]]; then
    echo "${BASH_REMATCH[2]}"
    return
  fi
  env=$(unit_env "$PANEL_UNIT")
  if [[ $env =~ (^|[[:space:]])PORT=([0-9]+) ]]; then
    echo "${BASH_REMATCH[2]}"
    return
  fi
  echo 3000
}

# Каталог, где лежат и node, и npm: из ExecStart, иначе PATH root, иначе
# login-shell владельца (nvm).
node_dir() {
  local first unit dir
  for unit in "$PANEL_UNIT" "$BOT_UNIT"; do
    first=$(grep -E '^ExecStart=' "$UNIT_DIR/$unit" | head -1 | sed -E 's/^ExecStart=[-@!+:]*//; s/[[:space:]].*//')
    dir=$(dirname "$first")
    if [[ $first == /* && -x $dir/node && -x $dir/npm ]]; then
      echo "$dir"
      return
    fi
  done
  for dir in "$(dirname "$(command -v node || echo /nonexistent/node)")" \
    "$( [[ $OWNER == root ]] || sudo -H -u "$OWNER" bash -lc 'dirname "$(command -v node)"' 2>/dev/null)"; do
    if [[ -x $dir/node && -x $dir/npm ]]; then
      echo "$dir"
      return
    fi
  done
  die "не найден каталог с node и npm"
}

as_owner() {
  if [[ $OWNER == root ]]; then
    env PATH="$NODE_DIR:$PATH" "$@"
  else
    sudo -H -u "$OWNER" env PATH="$NODE_DIR:$PATH" "$@"
  fi
}

# --- Вспомогательные программы (node:sqlite и код приложения через tsx) ------------
write_tools() {
  TOOLS=$(mktemp -d /tmp/vps-update.XXXXXX)
  chmod 755 "$TOOLS"
  mkdir "$TOOLS/rt"
  chown "$OWNER" "$TOOLS/rt"
  cat >"$TOOLS/db.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
const [cmd, path, target] = process.argv.slice(2);
const db = new DatabaseSync(path, { readOnly: true });
db.exec("PRAGMA busy_timeout = 10000");
if (cmd === "snapshot") {
  db.prepare("VACUUM INTO ?").run(target);
  console.log("ok");
} else if (cmd === "info") {
  const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]).join(";");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const counts = Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));
  console.log(JSON.stringify({ integrity, version, counts }));
}
db.close();
EOF
  cat >"$TOOLS/open.mts" <<'EOF'
// Открывает копию базы кодом приложения — как при восстановлении из копии.
import { SqliteStore } from "@/bot/storage/sqlite";
const store = new SqliteStore(process.argv[2]);
console.log(JSON.stringify({ schema: store.schemaVersion }));
store.close();
EOF
  cat >"$TOOLS/config.mts" <<'EOF'
// Настройки бота новым кодом в окружении службы: только режим, число тестовых ID и
// ошибки (без значений). Аргументы: Environment юнита, затем EnvironmentFile.
import { loadBotConfig } from "@/bot/config";
import { loadLocalEnv } from "@/bot/env";
const [unitEnv = "", ...files] = process.argv.slice(2);
for (const pair of unitEnv.split(" ").filter(Boolean)) {
  const i = pair.indexOf("=");
  if (i > 0) process.env[pair.slice(0, i)] ??= pair.slice(i + 1);
}
for (const file of files.reverse()) loadLocalEnv(file);
loadLocalEnv();
const r = loadBotConfig(process.env);
console.log(JSON.stringify(r.ok
  ? { ok: true, mode: r.config.mode, allowed: r.config.vk.allowedUserIds === "all" ? "all" : r.config.vk.allowedUserIds.size, miniApp: r.config.vk.miniAppId !== undefined, medicalKey: Boolean(r.config.cipher) }
  : { ok: false, errors: r.errors }));
EOF
  chmod 644 "$TOOLS"/*.m*s
}
cleanup_tools() { [[ -z $TOOLS ]] || rm -rf "$TOOLS"; }
trap cleanup_tools EXIT

db_tool() { "$NODE_DIR/node" --no-warnings "$TOOLS/db.mjs" "$@"; }
tsx_tool() { # от root: .env.local может быть доступен только root
  (cd "$APP" && env PATH="$NODE_DIR:$PATH" "$APP/node_modules/.bin/tsx" --tsconfig "$APP/tsconfig.json" "$@")
}
counts() { sed -E 's/.*"counts"://; s/}$//' <<<"$1"; }
summary() { sed -E 's/,"counts":.*$/}/' <<<"$1"; }

# --- HTTP ---------------------------------------------------------------------------
HOSTS=()
detect_hosts() {
  command -v nginx >/dev/null || return 0
  mapfile -t HOSTS < <(nginx -T 2>/dev/null | sed -nE 's/^[[:space:]]*server_name[[:space:]]+([^;]+);.*/\1/p' |
    tr ' ' '\n' | grep -E '^[a-z0-9.-]+\.[a-z]{2,}$' | sort -u || true)
}
http_codes() { # «адрес=код»: панель напрямую и адреса nginx на этом сервере
  local path host
  for path in "${PATHS[@]}"; do
    printf 'local%s=%s\n' "$path" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:$PORT$path" || true)"
  done
  for host in "${HOSTS[@]}"; do
    for path in "${PATHS[@]}"; do
      printf '%s%s=%s\n' "$host" "$path" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$host:443:127.0.0.1" "https://$host$path" || true)"
    done
  done
}
wait_http() {
  local i
  for i in $(seq 1 90); do
    [[ $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/admin/login" || true) == 200 ]] && return 0
    sleep 1
  done
  return 1
}
wait_bot() {
  local i
  for i in $(seq 1 60); do
    systemctl is-active --quiet "$BOT_UNIT" || return 1
    journalctl -u "$BOT_UNIT" --since "$STARTED_AT" --no-pager -o cat 2>/dev/null | grep -q "long poll: connected" && return 0
    sleep 1
  done
  return 1
}

stop_services() {
  say "остановка: $BOT_UNIT, $PANEL_UNIT"
  systemctl stop "$BOT_UNIT" || true
  systemctl stop "$PANEL_UNIT" || true
}
start_services() {
  STARTED_AT=$(date '+%Y-%m-%d %H:%M:%S')
  say "запуск: $PANEL_UNIT, $BOT_UNIT"
  systemctl start "$PANEL_UNIT" || true
  systemctl start "$BOT_UNIT" || true
}
check_after_start() { # 0 — бот и панель работают, ответы адресов как до обновления
  local ok=0
  wait_http || {
    say "панель не ответила 200 на /admin/login за 90 с"
    ok=1
  }
  wait_bot || {
    say "бот не подключился к Long Poll за 60 с"
    ok=1
  }
  http_codes >"$BK/http-after.txt"
  if ! diff "$BK/http-before.txt" "$BK/http-after.txt" >"$BK/http-diff.txt"; then
    say "ответы адресов отличаются от прежних:"
    sed 's/^/    /' "$BK/http-diff.txt"
    ok=1
  fi
  return $ok
}

# --- Откат кода: каталог .data и база не затрагиваются ------------------------------
complete_copy() { [[ -f $1/package.json && -d $1/.git && -d $1/.next && -d $1/node_modules ]]; }
rollback_now() { # $1 — код выхода при успешном откате
  ROLLING=1
  trap - ERR
  set +e
  say "ОТКАТ к коду $BASE_SHORT из $ROLLBACK_DIR"
  stop_services
  if [[ -n ${DB:-} ]] && db_tool snapshot "$DB" "$BK/db-before-rollback.sqlite" >/dev/null; then
    say "копия базы перед откатом: $BK/db-before-rollback.sqlite"
  fi
  if [[ -n $ROLLBACK_DIR ]] && complete_copy "$ROLLBACK_DIR"; then
    find "$APP" -mindepth 1 -maxdepth 1 ! -name .data -exec rm -rf {} +
    tar -C "$ROLLBACK_DIR" -cf - . | tar -C "$APP" -xpf -
    say "код восстановлен (каталог .data не затрагивался)"
  else
    say "каталога отката нет или он неполный — код не трогаю, запускаю службы как есть"
  fi
  start_services
  if check_after_start; then
    say "ОТКАТ ВЫПОЛНЕН: работает $(as_owner git -C "$APP" rev-parse --short HEAD), база не восстанавливалась из копии"
  else
    say "ОТКАТ ВЫПОЛНЕН, НО ПРОВЕРКИ НЕ ПРОШЛИ — нужна ручная проверка; база не тронута"
  fi
  say "журнал: $BK/update.log"
  exit "${1:-1}"
}
on_error() {
  # Ошибка в подоболочке $(…) — обрабатывает основной процесс по коду возврата.
  [[ $BASHPID == "$$" ]] || exit 1
  say "ошибка (строка $1, этап $PHASE)"
  case $PHASE in
  stopped | updated | started) rollback_now 1 ;;
  *) say "службы не останавливались — ничего не изменено" ;;
  esac
  exit 1
}
trap 'on_error $LINENO' ERR

prepare() {
  detect_units
  NODE_DIR=$(node_dir)
  PORT=$(panel_port)
  local bot_db panel_db
  bot_db=$(cfg_value "$BOT_UNIT" BOT_DB_PATH)
  panel_db=$(cfg_value "$PANEL_UNIT" BOT_DB_PATH)
  DB=$(cd "$APP" && realpath -m "${bot_db:-.data/bot.sqlite}")
  [[ $DB == $(cd "$APP" && realpath -m "${panel_db:-.data/bot.sqlite}") ]] || die "у бота и панели разные BOT_DB_PATH"
  [[ -f $DB ]] || die "база $DB не найдена"
  [[ $DB != "$APP"/* || $DB == "$APP"/.data/* ]] || die "база $DB внутри $APP, но не в .data — откат кода мог бы её задеть"
  write_tools
  detect_hosts
  say "приложение $APP (владелец $OWNER); службы: бот $BOT_UNIT, панель $PANEL_UNIT (порт $PORT)"
  say "node $("$NODE_DIR/node" -v) ($NODE_DIR); база $DB; адреса nginx: ${HOSTS[*]:-нет}"
}

case $MODE in
update)
  TARGET=${2:-}
  BASE=${3:-47323c6}
  [[ -n $TARGET ]] || die "укажите коммит: update <коммит>"
  say "== обновление $APP → $TARGET; копии и журнал: $BK"
  prepare

  # 1. Проверки без изменений
  HEAD_SHA=$(as_owner git rev-parse HEAD)
  BASE_SHA=$(as_owner git rev-parse --verify -q "$BASE^{commit}" || true)
  [[ $HEAD_SHA == "$BASE_SHA" ]] || die "на сервере ${HEAD_SHA:0:7}, а ожидался $BASE — скрипт рассчитан на другую версию"
  BASE_SHORT=${HEAD_SHA:0:7}
  TARGET_SHA=$(as_owner git rev-parse --verify -q "$TARGET^{commit}" || true)
  [[ -n $TARGET_SHA ]] || die "коммита $TARGET нет: сначала git fetch"
  as_owner git merge-base --is-ancestor "$HEAD_SHA" "$TARGET_SHA" || die "$TARGET не продолжает $BASE_SHORT"
  DIRTY=$(as_owner git status --porcelain --untracked-files=no)
  [[ -z $DIRTY ]] || die "в $APP изменены файлы из Git: $(awk '{print $2}' <<<"$DIRTY" | tr '\n' ' ')"
  migrations() { as_owner git show "$1:src/bot/storage/sqlite.ts" | sed -n '/^const MIGRATIONS/,/^export const SCHEMA_VERSION/p' | sha256sum; }
  OLD_SCHEMA=$(migrations "$HEAD_SHA")
  NEW_SCHEMA=$(migrations "$TARGET_SHA")
  [[ $(as_owner git diff "$HEAD_SHA" "$TARGET_SHA" -- src/bot/storage/sqlite.ts | grep -cE '^\+.*(CREATE|ALTER|DROP) ' || true) == 0 &&
    $OLD_SCHEMA == "$NEW_SCHEMA" ]] || die "в $TARGET изменена схема базы — этот скрипт обновляет только без миграций"
  for unit in "$BOT_UNIT" "$PANEL_UNIT"; do
    systemctl is-active --quiet "$unit" || die "служба $unit не работает до обновления"
  done
  MODE_VALUE=$(cfg_value "$BOT_UNIT" BOT_MODE)
  [[ -z $MODE_VALUE || $MODE_VALUE == demo ]] || die "BOT_MODE=$MODE_VALUE — обновление рассчитано только на demo"
  [[ -n $(cfg_value "$BOT_UNIT" VK_ALLOWED_USER_IDS) ]] ||
    die "VK_ALLOWED_USER_IDS не задан — новая версия бота в режиме demo без тестовых ID не запустится"
  CODE_KB=$(du -sk --exclude=./.data "$APP" | cut -f1)
  DB_KB=$(du -sk "$DB" | cut -f1)
  FREE_KB=$(df -Pk "$(dirname "$APP")" | awk 'NR==2 {print $4}')
  FREE_BK=$(df -Pk "$BACKUPS" | awk 'NR==2 {print $4}')
  ((FREE_KB > CODE_KB * 3 + 1048576)) || die "мало места у $APP: свободно $((FREE_KB / 1024)) МБ, нужно больше $(((CODE_KB * 3 + 1048576) / 1024)) МБ"
  ((FREE_BK > DB_KB * 4 + 102400)) || die "мало места для копий базы в $BACKUPS"
  http_codes >"$BK/http-before.txt"
  say "ответы адресов до обновления:"
  sed 's/^/    /' "$BK/http-before.txt"
  grep -q '^local/admin/login=200$' "$BK/http-before.txt" || die "панель не отвечает 200 на /admin/login до обновления"
  say "проверки пройдены: $BASE_SHORT → ${TARGET_SHA:0:7}, схема базы не меняется, места достаточно"

  # 2. Копии без остановки служб
  PHASE=backup
  mkdir -p "$BK/config"
  [[ -f $APP/.env.local ]] && cp -p "$APP/.env.local" "$BK/config/env.local"
  for unit in "$BOT_UNIT" "$PANEL_UNIT"; do
    cp -p "$UNIT_DIR/$unit" "$BK/config/"
    [[ ! -d $UNIT_DIR/$unit.d ]] || cp -rp "$UNIT_DIR/$unit.d" "$BK/config/"
    while read -r file; do [[ -z $file || ! -f $file ]] || cp -p "$file" "$BK/config/"; done < <(unit_env_files "$unit")
  done
  [[ ! -d /etc/nginx ]] || tar -C /etc -czf "$BK/config/nginx.tgz" nginx
  stat -c '%a %U:%G %n' "$APP" "$APP"/.env.local "$(dirname "$DB")" "$DB"* >"$BK/config/permissions.txt" 2>/dev/null || true
  sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z0-9_]+)[[:space:]]*=.*/\2/p' "$APP/.env.local" 2>/dev/null | sort >"$BK/config/env-keys.txt" || true
  say "конфигурация: $BK/config (.env.local, юниты, nginx, права; доступ только root)"
  ROLLBACK_DIR="${APP}.prev-${BASE_SHORT}-$STAMP"
  mkdir "$ROLLBACK_DIR"
  chmod 755 "$ROLLBACK_DIR"
  tar -C "$APP" --exclude=./.data -cf - . | tar -C "$ROLLBACK_DIR" -xpf -
  complete_copy "$ROLLBACK_DIR" || die "копия кода $ROLLBACK_DIR неполная (нет .next или node_modules)"
  say "код $BASE_SHORT для отката (без .data): $ROLLBACK_DIR"
  db_tool snapshot "$DB" "$BK/db-online.sqlite" >/dev/null
  say "предварительная копия базы (VACUUM INTO без остановки): $BK/db-online.sqlite"

  # 3. Остановка, согласованная копия базы, проверка восстановления
  PHASE=stopped
  stop_services
  db_tool snapshot "$DB" "$BK/db-before-update.sqlite" >/dev/null
  LIVE=$(db_tool info "$DB")
  COPY=$(db_tool info "$BK/db-before-update.sqlite")
  [[ $LIVE == "$COPY" ]] || die "копия базы не совпадает с рабочей"
  [[ $COPY == *'"integrity":"ok"'* ]] || die "integrity_check копии базы — не ok"
  cp "$BK/db-before-update.sqlite" "$TOOLS/rt/restore-test.sqlite"
  chown "$OWNER" "$TOOLS/rt/restore-test.sqlite"
  RESTORED=$(cd "$APP" && as_owner "$APP/node_modules/.bin/tsx" --tsconfig "$APP/tsconfig.json" "$TOOLS/open.mts" "$TOOLS/rt/restore-test.sqlite")
  [[ $RESTORED == *'"schema":'"$(sed -nE 's/.*"version":([0-9]+).*/\1/p' <<<"$COPY")"* ]] || die "копия открылась с другой версией схемы: $RESTORED"
  rm -f "$TOOLS"/rt/restore-test.sqlite*
  sha256sum "$BK"/db-*.sqlite >"$BK/SHA256SUMS"
  say "копия базы после остановки: $BK/db-before-update.sqlite — совпадает с рабочей, integrity ok, открыта кодом $BASE_SHORT ($RESTORED)"
  say "база до обновления: $(summary "$LIVE"), строк: $(counts "$LIVE")"

  # 4. Код
  PHASE=updated
  say "git checkout ${TARGET_SHA:0:7}, npm ci, build (службы остановлены)"
  as_owner git checkout -q --detach "$TARGET_SHA"
  (cd "$APP" && as_owner npm ci --no-audit --no-fund --loglevel=error >"$BK/npm-ci.log" 2>&1) || {
    tail -20 "$BK/npm-ci.log"
    die "npm ci не выполнен"
  }
  (cd "$APP" && as_owner env NODE_OPTIONS=--max-old-space-size=1024 npm run build >"$BK/build.log" 2>&1) || {
    tail -30 "$BK/build.log"
    die "сборка не выполнена"
  }
  say "сборка выполнена ($BK/build.log)"
  CONFIG=$(tsx_tool "$TOOLS/config.mts" "$(unit_env "$BOT_UNIT")" $(unit_env_files "$BOT_UNIT"))
  say "настройки бота новым кодом: $CONFIG"
  [[ $CONFIG == *'"ok":true'* && $CONFIG == *'"mode":"demo"'* ]] || die "настройки бота не приняты новым кодом или режим не demo"
  [[ $(db_tool info "$DB") == "$LIVE" ]] || die "база изменилась при обновлении кода"

  # 5. Запуск и проверки
  PHASE=started
  start_services
  check_after_start || die "проверки после запуска не прошли"
  PHASE=done
  NOW=$(db_tool info "$DB")
  say "ГОТОВО: установлен ${TARGET_SHA:0:7} (был $BASE_SHORT)"
  say "службы: $BOT_UNIT — $(systemctl is-active "$BOT_UNIT"), $PANEL_UNIT — $(systemctl is-active "$PANEL_UNIT")"
  say "бот: $(journalctl -u "$BOT_UNIT" --since "$STARTED_AT" --no-pager -o cat 2>/dev/null | grep -m1 -oE 'сообщество .*' | sed -E 's/^сообщество [0-9]+, //' | cut -c1-300)"
  say "база после запуска: $(summary "$NOW"), строк: $(counts "$NOW")"
  say "копии: $BK (база — db-before-update.sqlite), код $BASE_SHORT для отката: $ROLLBACK_DIR"
  say "откат кода: sudo bash $BK/vps-update.sh rollback $ROLLBACK_DIR"
  ;;
rollback)
  ROLLBACK_DIR=${2:-}
  [[ -n $ROLLBACK_DIR ]] && complete_copy "$ROLLBACK_DIR" || die "укажите полный каталог отката: rollback ${APP}.prev-…"
  say "== откат $APP к коду из $ROLLBACK_DIR (база не восстанавливается)"
  prepare
  BASE_SHORT=$(as_owner git -C "$ROLLBACK_DIR" rev-parse --short HEAD 2>/dev/null || echo "?")
  http_codes >"$BK/http-before.txt"
  PHASE=stopped
  rollback_now 0
  ;;
*)
  die "режим: update <коммит> [<текущий>] | rollback <каталог>"
  ;;
esac
