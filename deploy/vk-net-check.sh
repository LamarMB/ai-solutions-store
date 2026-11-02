#!/usr/bin/env bash
# Диагностика связи сервера с ВКонтакте — только чтение, ничего не меняет.
#
#   sudo bash vk-net-check.sh
#
# Для каждого адреса: DNS (IPv4 и IPv6), TCP-соединение с портом 443 по IPv4 и
# IPv6, HTTPS-ответ. Для сравнения — российский и зарубежный сайты и Telegram.
# Токены и данные бота не используются.
set -uo pipefail

HOSTS=(api.vk.com lp.vk.com vk.com ya.ru google.com api.telegram.org)

tcp() { # $1 — адрес; 0 — порт 443 открыт за 8 с
  timeout 8 bash -c "exec 3<>/dev/tcp/$1/443" 2>/dev/null
}

echo "== DNS и TCP:443"
for h in "${HOSTS[@]}"; do
  v4=$(getent ahostsv4 "$h" 2>/dev/null | awk 'NR==1 {print $1}')
  v6=$(getent ahostsv6 "$h" 2>/dev/null | awk '$1 ~ /:/ && $1 !~ /^::ffff:/ {print $1; exit}')
  r4="нет адреса"
  [[ -n $v4 ]] && { tcp "$v4" && r4="TCP открыт" || r4="TCP НЕ ОТКРЫВАЕТСЯ"; }
  r6="нет адреса"
  [[ -n $v6 ]] && { tcp "$v6" && r6="TCP открыт" || r6="TCP НЕ ОТКРЫВАЕТСЯ"; }
  printf '  %-17s IPv4 %-15s %-20s | IPv6 %s\n' "$h" "${v4:--}" "$r4" "$r6"
done

echo "== HTTPS (код ответа, время, с)"
for h in api.vk.com lp.vk.com ya.ru api.telegram.org; do
  for f in -4 -6; do
    out=$(curl $f -s -o /dev/null --max-time 12 -w '%{http_code} %{time_total}' "https://$h/" 2>/dev/null)
    printf '  %-17s %s: %s\n' "$h" "${f/-/IPv}" "${out:-нет ответа}"
  done
done

echo "== Маршрут до api.vk.com (первые 15 узлов)"
if command -v tracepath >/dev/null; then
  timeout 40 tracepath -n -m 15 api.vk.com 2>/dev/null | head -18
elif command -v traceroute >/dev/null; then
  timeout 40 traceroute -n -m 15 -w 2 api.vk.com 2>/dev/null | head -18
else
  echo "  tracepath/traceroute не установлены — пропущено"
fi

echo "== Внешний IP сервера и прокси в окружении бота"
curl -4 -s --max-time 8 https://ifconfig.me 2>/dev/null && echo
systemctl show -p Environment --value vk-bot.service 2>/dev/null | tr ' ' '\n' | grep -iE '^(https?|all|no)_proxy=' | sed -E 's/=.*/=<задан>/' || true
echo "Готово. Ничего не изменено."
