#!/usr/bin/env bash
# Поиск и устранение блокировки ВКонтакте и GitHub на самом сервере.
# Сначала только диагностика; исправление — только после «да».
set -u
VK=(87.240.190.70 93.186.225.205)
GH=(140.82.121.3)
ALL=("${VK[@]}" "${GH[@]}")
tcp() { timeout 6 bash -c "exec 3<>/dev/tcp/$1/443" 2>/dev/null; }
check() {
  local ok=0 ip
  for ip in "${ALL[@]}"; do
    if tcp "$ip"; then echo "  $ip:443 — открыт"; else echo "  $ip:443 — НЕ открывается"; ok=1; fi
  done
  return $ok
}
ask() { printf '%s ' "$1" >/dev/tty; IFS= read -r REPLY </dev/tty || REPLY=; [[ $REPLY == да ]]; }

[[ $EUID -eq 0 ]] || { echo "нужен sudo"; exit 1; }
echo "== 1. Сейчас (ВКонтакте: ${VK[*]}; GitHub: ${GH[*]})"
if check; then echo "Всё открывается — блокировки нет. Бот переподключится сам в течение минуты."; exit 0; fi

FOUND=0
echo "== 2. Маршруты"
for ip in "${ALL[@]}"; do echo "  $(ip route get "$ip" 2>&1 | head -1)"; done
BAD_ROUTES=$(ip route show table all 2>/dev/null | grep -E '^(blackhole|unreachable|prohibit) ' || true)
[[ -n $BAD_ROUTES ]] && { echo "  блокирующие маршруты:"; echo "$BAD_ROUTES" | sed 's/^/    /'; FOUND=1; }
RULES=$(ip rule | grep -vE '^(0|32766|32767):' || true)
[[ -n $RULES ]] && { echo "  нестандартные правила маршрутизации:"; echo "$RULES" | sed 's/^/    /'; }

echo "== 3. Межсетевой экран"
UFW_OUT=$(ufw status numbered 2>/dev/null | grep -E 'OUT' | grep -iE 'DENY|REJECT' || true)
[[ -n $UFW_OUT ]] && { echo "  запрещающие правила ufw для исходящих:"; echo "$UFW_OUT" | sed 's/^/    /'; FOUND=1; }
DEFAULT_OUT=$(ufw status verbose 2>/dev/null | grep -iE '^Default:' || true)
[[ -n $DEFAULT_OUT ]] && echo "  $DEFAULT_OUT"
IPT=$(iptables -S 2>/dev/null | grep -E -- '-d (87\.240\.|93\.186\.|95\.142\.|95\.213\.|140\.82\.|185\.199\.)' || true)
[[ -n $IPT ]] && { echo "  правила iptables для адресов ВКонтакте/GitHub:"; echo "$IPT" | sed 's/^/    /'; FOUND=1; }
MANGLE=$(iptables -t mangle -S 2>/dev/null | grep -vE '^-P ' || true)
[[ -n $MANGLE ]] && { echo "  есть правила iptables mangle (перенаправление трафика):"; echo "$MANGLE" | head -10 | sed 's/^/    /'; }

echo "== 4. VPN и прокси на сервере"
PROCS=$(ps -eo comm= | grep -iE 'xray|v2ray|sing-box|openvpn|wg-quick|tun2socks|hysteria|clash|3x-ui|x-ui' | sort -u || true)
[[ -n $PROCS ]] && echo "  процессы: $(echo $PROCS)"
LINKS=$(ip -br link 2>/dev/null | grep -iE '^(tun|wg|tap)' || true)
[[ -n $LINKS ]] && echo "  интерфейсы: $(echo "$LINKS" | awk '{print $1}' | tr '\n' ' ')"

echo "== 5. Исправление"
if [[ -n $UFW_OUT ]]; then
  if ask "Удалить запрещающие правила ufw для исходящих (выше)? Введите «да»:"; then
    for n in $(echo "$UFW_OUT" | grep -oE '^\[ *[0-9]+\]' | tr -d '[] ' | sort -rn); do yes | ufw delete "$n" >/dev/null; done
    echo "  правила удалены"
  fi
fi
if [[ -n $BAD_ROUTES ]]; then
  if ask "Удалить блокирующие маршруты (выше)? Введите «да»:"; then
    while read -r line; do ip route del $line 2>/dev/null; done <<<"$BAD_ROUTES"
    echo "  маршруты удалены"
  fi
fi
if [[ -n $IPT ]]; then
  if ask "Удалить правила iptables для адресов ВКонтакте/GitHub (выше)? Введите «да»:"; then
    while read -r rule; do iptables $(echo "$rule" | sed 's/^-A /-D /') 2>/dev/null; done <<<"$IPT"
    echo "  правила удалены"
  fi
fi

echo "== 6. Проверка после"
if check; then
  echo "ГОТОВО: ВКонтакте и GitHub открываются. VK-бот переподключится сам в течение минуты."
  exit 0
fi
if [[ $FOUND == 0 && -z $PROCS && -z $LINKS && -z $MANGLE ]]; then
  cat <<'EOF'
На сервере блокировки нет — это сеть хостинга. Отправьте в поддержку powerrdp:

  Сервер 13.143.165.8 (pwr-s2809.powerrdp.pro). С 2 ноября 2026 не устанавливаются
  исходящие TCP-соединения с адресами ВКонтакте (87.240.190.70:443, 93.186.225.205:443)
  и GitHub (140.82.121.3:443): тайм-аут. Остальные адреса по IPv4 работают (google.com,
  ya.ru, 1.1.1.1:443), межсетевой экран сервера эти адреса не блокирует. До 31 октября
  всё работало. Просьба проверить фильтрацию исходящего трафика и маршрутизацию до этих сетей.
EOF
else
  echo "Найдены VPN/прокси или перенаправление трафика (выше) — пришлите вывод, подскажу точное исправление."
fi
exit 1
