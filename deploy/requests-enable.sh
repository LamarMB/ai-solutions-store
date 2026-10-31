#!/usr/bin/env bash
# Включение приёма заявок с сайта в Telegram на существующем VPS — docs/requests.md.
#
#   sudo bash requests-enable.sh <коммит> <текущий коммит>
#
# Интерактивно (нужен ssh -t): токен бота (ввод скрыт) → проверка getMe → chat ID
# (после /start боту — определяется сам) → данные оператора персональных данных →
# подтверждение публикации политики → пробное сообщение в Telegram → запись
# настроек в .env.local (с копией) → обновление кода и сборка через
# deploy/vps-update.sh (копии, проверки, откат) → две проверочные заявки от обеих
# форм тем же обработчиком → проверка страниц. Токен не выводится и не попадает в
# аргументы команд (curl читает адрес из stdin). VK-бот, Mini App и база не меняются.
set -Eeuo pipefail
umask 077

TARGET=${1:-}
BASE=${2:-}
APP=${VPS_APP:-/opt/ai-solutions-store}
ENV_FILE="$APP/.env.local"
BACKUPS=${VPS_BACKUPS:-/root/demo-med-backups}
TG=${REQUESTS_TELEGRAM_API:-https://api.telegram.org}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BK="$BACKUPS/requests-$STAMP"
TMP=$(mktemp -d /tmp/requests-enable.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() {
  say "СТОП: $*"
  exit 1
}
ask() { # $1 — вопрос; ответ в REPLY
  printf '%s ' "$1" >/dev/tty
  IFS= read -r REPLY </dev/tty || die "ввод прерван — ничего не изменено"
}
[[ $EUID -eq 0 ]] || die "запустите через sudo"
[[ -n $TARGET && -n $BASE ]] || die "использование: requests-enable.sh <коммит> <текущий коммит>"
[[ -t 0 || -e /dev/tty ]] || die "нужен интерактивный терминал (ssh -t)"
[[ -f $ENV_FILE ]] || die "нет $ENV_FILE"
command -v node >/dev/null || die "node не найден"
mkdir -p "$BK"
chmod 700 "$BACKUPS" "$BK"

# Bot API: адрес с токеном передаётся curl через stdin, а не в аргументах.
tg() { # $1 — метод, $2 — JSON-тело (необязательно)
  {
    printf 'url = "%s/bot%s/%s"\n' "$TG" "$TOKEN" "$1"
    printf 'header = "Content-Type: application/json"\n'
    [[ -n ${2:-} ]] && printf 'data = %s\n' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
  } | curl -s --max-time 20 -K - || true
}
json() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const v=Function("j","return "+process.argv[1])(JSON.parse(d));process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }
current() { sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?[[:space:]]*$/\1/p" "$ENV_FILE" | tail -1; }

# Скрипт обновления — заранее, до любых изменений.
OWNER=$(stat -c %U "$APP")
sudo -H -u "$OWNER" git -C "$APP" show "$TARGET:deploy/vps-update.sh" >"$TMP/vps-update.sh" 2>/dev/null ||
  die "коммита $TARGET нет на сервере — сначала git fetch"
HEAD_SHA=$(sudo -H -u "$OWNER" git -C "$APP" rev-parse HEAD)
TARGET_SHA=$(sudo -H -u "$OWNER" git -C "$APP" rev-parse "$TARGET^{commit}")
# Код уже обновлён (повторный запуск) — только пересборка с новыми настройками.
[[ $HEAD_SHA == "$TARGET_SHA" ]] && BASE=$TARGET

say "== включение приёма заявок; копии и журнал: $BK"
say "Понадобятся: токен бота от @BotFather, доступ к Telegram-аккаунту владельца, ФИО или название оператора, ИНН и email для запросов о данных."

# 1. Токен бота
TOKEN=$(current REQUESTS_TELEGRAM_BOT_TOKEN)
if [[ -n $TOKEN ]]; then
  ask "Токен бота уже задан. Оставить его? [да/нет]:"
  [[ $REPLY =~ ^(да|y|yes|д)$ ]] || TOKEN=
fi
if [[ -z $TOKEN ]]; then
  printf 'Вставьте токен бота от @BotFather (ввод не отображается): ' >/dev/tty
  IFS= read -rs TOKEN </dev/tty || die "ввод прерван — ничего не изменено"
  echo >/dev/tty
fi
[[ $TOKEN =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || die "это не похоже на токен бота (вид: 123456789:AA…)"
ME=$(tg getMe)
BOT=$(json 'j.ok?j.result.username:""' <<<"$ME")
[[ -n $BOT ]] || die "Telegram не принял токен ($(json 'j.description' <<<"$ME"))"
say "бот: @$BOT"

# 2. Чат владельца
CHAT=$(current REQUESTS_TELEGRAM_CHAT_ID)
if [[ -n $CHAT ]]; then
  ask "Chat ID уже задан. Оставить его? [да/нет]:"
  [[ $REPLY =~ ^(да|y|yes|д)$ ]] || CHAT=
fi
if [[ -z $CHAT ]]; then
  ask "Откройте t.me/$BOT с аккаунта, куда должны приходить заявки, нажмите «Запустить» (или отправьте /start), затем нажмите Enter здесь."
  for i in 1 2 3 4 5 6; do
    UPD=$(tg getUpdates)
    CHAT=$(json '(j.result||[]).map(u=>u.message).filter(m=>m&&m.chat&&m.chat.type==="private").map(m=>m.chat.id).pop()' <<<"$UPD")
    WHO=$(json '(j.result||[]).map(u=>u.message).filter(m=>m&&m.chat&&m.chat.type==="private").map(m=>m.chat.username?"@"+m.chat.username:(m.chat.first_name||"")).pop()' <<<"$UPD")
    [[ -n $CHAT ]] && break
    sleep 5
  done
  [[ -n $CHAT ]] || die "сообщение боту не найдено — отправьте /start боту @$BOT и запустите команду снова"
  ask "Заявки будут приходить в чат с $WHO. Верно? [да/нет]:"
  [[ $REPLY =~ ^(да|y|yes|д)$ ]] || die "отменено"
fi
[[ $CHAT =~ ^-?[0-9]+$ ]] || die "chat ID должен быть числом"

# 3. Оператор персональных данных. Каждое поле проверяется (кодировка, символы);
# при ошибке вопрос повторяется. Enter — оставить сохранённое значение.
valid() { # $1 — вид поля, $2 — значение; 0 — корректно
  node -e '
    const [kind, v] = process.argv.slice(1);
    if (/[\uFFFD\u0000-\u001f"\\]/.test(v)) process.exit(1);
    const re = { name: /^[\p{L}][\p{L}\s.\-«»()]{2,149}$/u, inn: /^(\d{10}|\d{12})$/, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }[kind];
    process.exit(re.test(v) ? 0 : 1);' "$1" "$2"
}
field() { # $1 — вид, $2 — вопрос, $3 — сохранённое значение; результат в REPLY
  local saved=$3 i
  for i in 1 2 3; do
    if [[ -n $saved ]]; then ask "$2 [Enter — оставить «$saved»]:"; else ask "$2"; fi
    [[ -z $REPLY && -n $saved ]] && REPLY=$saved
    valid "$1" "$REPLY" && return 0
    printf 'Не похоже на корректное значение (возможно, при исправлении ввода стёрлась часть буквы). Введите заново, без исправлений, или вставьте из буфера.\n' >/dev/tty
  done
  die "некорректный ввод — ничего не изменено"
}
OP_NAME=$(current PRIVACY_OPERATOR_NAME)
valid name "$OP_NAME" || OP_NAME=
field name "Оператор персональных данных — ФИО полностью (если ИП — «ИП Фамилия Имя Отчество»):" "$OP_NAME"
OP_NAME=$REPLY
ask "Проверьте написание: «$OP_NAME». Верно? [да/нет]:"
[[ $REPLY =~ ^(да|y|yes|д)$ ]] || die "отменено — запустите команду снова и введите имя заново; ничего не изменено"
field inn "ИНН оператора (10 или 12 цифр):" "$(current PRIVACY_OPERATOR_INN)"
OP_INN=$REPLY
field email "Email для запросов о персональных данных (будет опубликован на /privacy):" "$(current PRIVACY_OPERATOR_EMAIL)"
OP_EMAIL=$REPLY

cat >/dev/tty <<EOF

Будет опубликована политика обработки персональных данных (/privacy):
  Оператор: $OP_NAME, ИНН $OP_INN; запросы — $OP_EMAIL.
  Данные: имя, клиника, способ связи и контакт, текст заявки.
  Цель: связаться по заявке. Основание: согласие в форме (п. 1 ч. 1 ст. 6 152-ФЗ).
  Заявка не хранится на сервере сайта, передаётся оператору в Telegram (серверы
  Telegram могут быть за пределами РФ) и удаляется после достижения цели или
  отзыва согласия. Полный текст — src/content/privacy.ts.
После этого формы на главной и /request начнут отправлять заявки в Telegram.
EOF
ask "Опубликовать политику и включить приём заявок? Введите «да»:"
[[ $REPLY == да ]] || die "отменено, ничего не изменено"

# 4. Пробное сообщение
SENT=$(tg sendMessage "{\"chat_id\":\"$CHAT\",\"text\":\"Проверка: сюда будут приходить заявки с сайта «Демо-Мед».\"}")
[[ $(json 'j.ok' <<<"$SENT") == true ]] || die "Telegram не доставил пробное сообщение ($(json 'j.description' <<<"$SENT"))"
ask "В Telegram пришло сообщение «Проверка: сюда будут приходить заявки…»? [да/нет]:"
[[ $REPLY =~ ^(да|y|yes|д)$ ]] || die "сообщение не получено — проверьте чат и запустите снова; ничего не изменено"

# 5. Настройки в .env.local (копия, владелец и права сохраняются)
cp -p "$ENV_FILE" "$BK/env.local"
set_env() {
  local key=$1 value=$2
  # -a: файл читается как текст, даже если в нём есть нестандартные байты.
  grep -a -v -E "^[[:space:]]*(export[[:space:]]+)?$key[[:space:]]*=" "$ENV_FILE" >"$TMP/env" || true
  printf '%s="%s"\n' "$key" "$value" >>"$TMP/env"
  cat "$TMP/env" >"$ENV_FILE" # cat > сохраняет владельца и права файла
}
set_env REQUESTS_TELEGRAM_BOT_TOKEN "$TOKEN"
set_env REQUESTS_TELEGRAM_CHAT_ID "$CHAT"
set_env PRIVACY_OPERATOR_NAME "$OP_NAME"
set_env PRIVACY_OPERATOR_INN "$OP_INN"
set_env PRIVACY_OPERATOR_EMAIL "$OP_EMAIL"
say "настройки записаны в $ENV_FILE (копия прежнего файла: $BK/env.local)"

# 6. Обновление кода и сборка (страницы собираются с новыми настройками)
if ! bash "$TMP/vps-update.sh" update "$TARGET" "$BASE"; then
  cp -p "$BK/env.local" "$ENV_FILE"
  die "обновление не выполнено (код возвращён скриптом обновления); прежний .env.local восстановлен"
fi

# 7. Проверочные заявки от обеих форм — настоящий Telegram, тот же обработчик
say "проверочные заявки (придут в Telegram с именем «Проверка доставки»):"
(cd "$APP" && node_modules/.bin/tsx --tsconfig tsconfig.json scripts/requests-check.mts) ||
  die "проверочные заявки не доставлены — формы покажут посетителю ошибку и ссылку на Telegram; откат настроек: cp -p $BK/env.local $ENV_FILE и обновление заново"

# 8. Страницы: форма на главной, политика, /request без тестового режима
PORT=$(grep -hoE -- '(-p|--port)[= ]+[0-9]+' /etc/systemd/system/clinic-admin.service 2>/dev/null | grep -oE '[0-9]+$' | head -1 || true)
PORT=${PORT:-3000}
page() { curl -s --noproxy '*' --max-time 15 "http://127.0.0.1:$PORT$1" || true; }
OK=1
[[ $(page /) == *"Заявка на демонстрацию"* ]] && say "  главная: форма заявки показана" || {
  say "  главная: формы нет"
  OK=0
}
[[ $(page /privacy) == *"$OP_INN"* ]] && say "  /privacy: политика опубликована" || {
  say "  /privacy: политики нет"
  OK=0
}
[[ $(page /request) != *"тестовом режиме"* ]] && say "  /request: рабочий режим" || {
  say "  /request: всё ещё тестовый режим"
  OK=0
}
[[ $OK == 1 ]] || die "страницы не в рабочем режиме — проверьте журнал $BK"
say "ГОТОВО: заявки с главной и /request приходят в Telegram (@$BOT → $CHAT)."
say "Отключить приём: удалите строки REQUESTS_TELEGRAM_* из $ENV_FILE и обновите сайт повторно; прежний файл — $BK/env.local"
