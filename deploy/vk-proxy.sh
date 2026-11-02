#!/usr/bin/env bash
# Обход блокировки ВКонтакте в сети хостинга основного VPS: запросы VK-бота к
# api.vk.com и lp.vk.com идут через HTTP-прокси на российском сервере.
#
#   на российском сервере:  sudo bash vk-proxy.sh relay <IP основного VPS> [порт]
#   на основном VPS:        sudo bash vk-proxy.sh bot   <IP российского сервера> [порт]
#   отмена на основном VPS: sudo bash vk-proxy.sh remove
#
# relay — tinyproxy только для IP основного VPS и только к доменам ВКонтакте
# (CONNECT на 443), порт открывается в ufw только для этого IP.
# bot — проверка прокси (curl к api.vk.com через него), drop-in для службы бота
# (NODE_USE_ENV_PROXY=1, HTTPS_PROXY, NO_PROXY), перезапуск бота, ожидание
# «long poll: connected» до 120 с; не подключился — drop-in удаляется, бот
# перезапускается как был. Код бота, база, панель и nginx не меняются. Шифрование
# до ВКонтакте сквозное (HTTPS через CONNECT): прокси не видит токен и сообщения.
set -Eeuo pipefail
MODE=${1:-}
PORT=${3:-8888}
UNIT=${VK_BOT_UNIT:-vk-bot.service}
DROPIN_DIR=/etc/systemd/system/$UNIT.d
DROPIN=$DROPIN_DIR/vk-proxy.conf

say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() {
  say "СТОП: $*"
  exit 1
}
[[ $EUID -eq 0 ]] || die "запустите через sudo"
ip4() { [[ $1 =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }

case $MODE in
relay)
  VPS=${2:-}
  ip4 "$VPS" || die "укажите IPv4 основного VPS: relay 13.143.165.8"
  [[ $PORT =~ ^[0-9]+$ ]] || die "порт — число"
  say "проверка: ВКонтакте с этого сервера"
  curl -s -o /dev/null --max-time 10 https://api.vk.com/ || die "этот сервер сам не видит api.vk.com — прокси здесь не поможет"
  if ! command -v tinyproxy >/dev/null; then
    say "установка tinyproxy"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tinyproxy >/dev/null
  fi
  CONF=/etc/tinyproxy/tinyproxy.conf
  [[ -f $CONF && ! -f $CONF.before-vk-proxy ]] && cp -p "$CONF" "$CONF.before-vk-proxy"
  cat >/etc/tinyproxy/vk-filter <<'EOF'
^api\.vk\.com$
^lp\.vk\.com$
^([a-z0-9-]+\.)?lp\.vk\.com$
EOF
  cat >"$CONF" <<EOF
# Прокси только для VK-бота «Демо-Мед» (deploy/vk-proxy.sh relay).
User tinyproxy
Group tinyproxy
Port $PORT
Timeout 120
DefaultErrorFile "/usr/share/tinyproxy/default.html"
LogLevel Warning
MaxClients 20
Allow $VPS
ConnectPort 443
DisableViaHeader Yes
Filter "/etc/tinyproxy/vk-filter"
FilterType ere
FilterURLs Off
FilterDefaultDeny Yes
EOF
  systemctl enable tinyproxy >/dev/null 2>&1 || true
  systemctl restart tinyproxy
  sleep 1
  systemctl is-active --quiet tinyproxy || die "tinyproxy не запустился: journalctl -u tinyproxy"
  if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
    ufw allow from "$VPS" to any port "$PORT" proto tcp comment 'vk-bot proxy' >/dev/null
    say "ufw: порт $PORT открыт только для $VPS"
  else
    say "ufw не активен — проверьте, что порт $PORT открыт у хостинга только для $VPS"
  fi
  say "ГОТОВО: прокси на порту $PORT для $VPS, только api.vk.com и lp.vk.com"
  ;;
bot)
  RELAY=${2:-}
  ip4 "$RELAY" || die "укажите IPv4 российского сервера: bot 194.35.112.57"
  PROXY="http://$RELAY:$PORT"
  systemctl cat "$UNIT" >/dev/null 2>&1 || die "служба $UNIT не найдена"
  say "проверка: api.vk.com через прокси $RELAY:$PORT"
  CODE=$(curl -s -o /dev/null --max-time 15 -x "$PROXY" -w '%{http_code}' https://api.vk.com/method/utils.getServerTime?v=5.199 || true)
  [[ $CODE == 200 ]] || die "прокси не отвечает или не пропускает (HTTP ${CODE:-нет ответа}) — сначала relay на российском сервере"
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  ((NODE_MAJOR >= 24)) || die "нужен Node.js 24+ (NODE_USE_ENV_PROXY), сейчас $NODE_MAJOR"
  mkdir -p "$DROPIN_DIR"
  [[ -f $DROPIN ]] && cp -p "$DROPIN" "/tmp/vk-proxy.conf.prev"
  cat >"$DROPIN" <<EOF
# Запросы VK-бота к ВКонтакте — через прокси на российском сервере (deploy/vk-proxy.sh).
# Отмена: sudo bash vk-proxy.sh remove
[Service]
Environment=NODE_USE_ENV_PROXY=1
Environment=HTTPS_PROXY=$PROXY
Environment=NO_PROXY=localhost,127.0.0.1,::1,api.openai.com,api.telegram.org
EOF
  systemctl daemon-reload
  SINCE=$(date '+%Y-%m-%d %H:%M:%S')
  systemctl restart "$UNIT"
  say "бот перезапущен, жду подключения к Long Poll (до 120 с)"
  for i in $(seq 1 120); do
    if journalctl -u "$UNIT" --since "$SINCE" --no-pager -o cat 2>/dev/null | grep -q 'long poll: connected'; then
      say "ГОТОВО: бот подключён к ВКонтакте через $RELAY:$PORT"
      exit 0
    fi
    sleep 1
  done
  say "бот не подключился за 120 с — отменяю настройку"
  rm -f "$DROPIN"
  [[ -f /tmp/vk-proxy.conf.prev ]] && mv /tmp/vk-proxy.conf.prev "$DROPIN"
  systemctl daemon-reload
  systemctl restart "$UNIT"
  journalctl -u "$UNIT" --since "$SINCE" --no-pager -o cat | grep -E 'long poll|failed' | tail -5 | sed -E 's/[0-9]{6,}/<id>/g'
  die "настройка отменена, бот работает как до запуска"
  ;;
remove)
  rm -f "$DROPIN"
  systemctl daemon-reload
  systemctl restart "$UNIT"
  say "ГОТОВО: прокси для бота отключён, бот перезапущен"
  ;;
*) die "режим: relay <IP VPS> | bot <IP российского сервера> | remove" ;;
esac
