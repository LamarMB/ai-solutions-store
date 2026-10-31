#!/usr/bin/env bash
# Публикация продающего сайта через nginx существующего VPS — docs/site-publish.md.
#
#   sudo bash site-publish.sh check    [домен]   только диагностика, ничего не меняет
#   sudo bash site-publish.sh apply    [домен]   диагностика → публикация → проверки → откат при ошибке
#   sudo bash site-publish.sh rollback <каталог копии>
#
# Находит server-блок, который реально обслуживает домен на 443 (по `nginx -T`, а не
# по имени файла), и заменяет в нём только `location / { return 404; }` на include
# со списком публичных страниц сайта (snippets/demo-med-site.conf). /admin, /miniapp и
# их API не трогаются; остальные адреса по-прежнему 404. Перед изменением — копия
# конфигурации nginx; после — `nginx -t`, перезагрузка и HTTPS-проверки публичных,
# защищённых и закрытых адресов; при любой ошибке — восстановление и перезагрузка.
set -Eeuo pipefail
umask 022

MODE=${1:-check}
HOST=${2:-13-143-165-8.sslip.io}
APP=${VPS_APP:-/opt/ai-solutions-store}
NGINX_DIR=${NGINX_DIR:-/etc/nginx}
BACKUPS=${VPS_BACKUPS:-/root/demo-med-backups}
SNIPPET="$NGINX_DIR/snippets/demo-med-site.conf"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BK="$BACKUPS/site-$STAMP"
TMP=$(mktemp -d /tmp/site-publish.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() {
  say "СТОП: $*"
  exit 1
}
[[ $EUID -eq 0 ]] || die "запустите через sudo"
command -v nginx >/dev/null || die "nginx не найден"
NODE=$(command -v node || true)
[[ -n $NODE ]] || die "node не найден"
mkdir -p "$BACKUPS" "$BK"
chmod 700 "$BACKUPS" "$BK"
exec > >(tee -a "$BK/site-publish.log") 2>&1

reload_nginx() { systemctl reload nginx 2>/dev/null || nginx -s reload; }

# --- Разбор конфигурации nginx (node) ----------------------------------------------
cat >"$TMP/nginx.mjs" <<'EOF'
// Разбор конфигурации nginx: токены, директивы с позициями в тексте файла.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";

function parse(text) {
  const tokens = [];
  let i = 0;
  let line = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "#") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "{" || c === "}" || c === ";") { tokens.push({ t: c, start: i, end: i + 1, line }); i++; continue; }
    const start = i;
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) { if (text[i] === "\\") i++; if (text[i] === "\n") line++; i++; }
      i++;
      tokens.push({ t: "w", v: text.slice(start + 1, i - 1), start, end: i, line });
      continue;
    }
    while (i < text.length && !/[\s;{}]/.test(text[i])) i++;
    tokens.push({ t: "w", v: text.slice(start, i), start, end: i, line });
  }
  let p = 0;
  function block() {
    const out = [];
    while (p < tokens.length && tokens[p].t !== "}") {
      const head = tokens[p];
      if (head.t !== "w") { p++; continue; }
      const args = [];
      p++;
      while (p < tokens.length && tokens[p].t === "w") args.push(tokens[p++].v);
      const d = { name: head.v, args, start: head.start, line: head.line, block: null, end: 0 };
      if (tokens[p]?.t === "{") { p++; d.block = block(); d.end = tokens[p]?.end ?? text.length; d.close = tokens[p]?.start ?? text.length; p++; }
      else { d.end = tokens[p]?.end ?? text.length; p++; }
      out.push(d);
    }
    return out;
  }
  return block();
}

const servers = (dirs, acc = []) => {
  for (const d of dirs) {
    if (d.name === "server" && d.block) acc.push(d);
    else if (d.block) servers(d.block, acc);
  }
  return acc;
};
const args = (s, name) => s.block.filter((d) => d.name === name).flatMap((d) => d.args);
const matches = (s, host) =>
  args(s, "server_name").includes(host) && args(s, "listen").some((a) => /(^|:)443$/.test(a));
const isClosedRoot = (d) =>
  d.name === "location" && d.args.length === 1 && d.args[0] === "/" && d.block &&
  d.block.length === 1 && d.block[0].name === "return" && d.block[0].args[0] === "404";

const [cmd, a1, a2, a3] = process.argv.slice(2);
if (cmd === "analyze") {
  // a1 — вывод `nginx -T`, a2 — домен.
  const dump = readFileSync(a1, "utf8");
  const parts = dump.split(/^# configuration file (.+):\s*$/m);
  const found = [];
  const defaults = [];
  for (let k = 1; k < parts.length; k += 2) {
    const file = parts[k];
    for (const s of servers(parse(parts[k + 1]))) {
      const listen = args(s, "listen");
      if (listen.some((a) => /(^|:)443$/.test(a)) && listen.includes("default_server")) defaults.push(`${file}:${s.line}`);
      if (!matches(s, a2)) continue;
      found.push({
        file,
        real: (() => { try { return realpathSync(file); } catch { return file; } })(),
        line: s.line,
        serverReturn: s.block.filter((d) => d.name === "return").map((d) => d.args.join(" ")),
        serverIf: s.block.filter((d) => d.name === "if").length,
        locations: s.block.filter((d) => d.name === "location").map((d) => ({
          args: d.args.join(" "),
          proxy: (d.block ?? []).filter((x) => x.name === "proxy_pass").map((x) => x.args[0])[0] ?? null,
          closedRoot: isClosedRoot(d),
          include: (d.block ?? []).some((x) => x.name === "include"),
        })),
        includes: s.block.filter((d) => d.name === "include").map((d) => d.args[0]),
      });
    }
  }
  console.log(JSON.stringify({ found, defaults }));
} else if (cmd === "patch") {
  // a1 — файл, a2 — домен, a3 — путь к сниппету. Меняет только первый подходящий блок.
  const text = readFileSync(a1, "utf8");
  const s = servers(parse(text)).find((x) => matches(x, a2));
  if (!s) { console.log("NO_BLOCK"); process.exit(2); }
  if (s.block.some((d) => d.name === "include" && d.args[0] === a3)) { console.log("ALREADY"); process.exit(0); }
  if (s.block.some((d) => d.name === "return")) { console.log("SERVER_RETURN"); process.exit(4); }
  const root = s.block.find((d) => d.name === "location" && d.args.length === 1 && d.args[0] === "/");
  if (root && !isClosedRoot(root)) { console.log("ROOT_NOT_404"); process.exit(3); }
  // «location = /» от прежних ручных попыток заменяется сниппетом (в нём свой).
  const exact = s.block.filter((d) => d.name === "location" && d.args.join(" ") === "= /");
  const edits = [
    ...exact.map((d) => ({ start: d.start, end: d.end, text: "" })),
    root
      ? { start: root.start, end: root.end, text: `include ${a3};` }
      : { start: s.close, end: s.close, text: `    include ${a3};\n` },
  ].sort((x, y) => y.start - x.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  writeFileSync(a1, out);
  console.log(`${root ? "REPLACED" : "INSERTED"}${exact.length ? `+REMOVED_EXACT_ROOT(${exact.length})` : ""}`);
}
EOF

# --- HTTPS-проверки через nginx этого сервера (--resolve на 127.0.0.1) ---------------
code() { curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$HOST:443:127.0.0.1" "https://$HOST$1" || echo 000; }
body() { curl -sk --noproxy '*' --max-time 15 --resolve "$HOST:443:127.0.0.1" "https://$HOST$1" || true; }

DEMO_IMG=$(ls "$APP/public/demo" 2>/dev/null | head -1 || true)
PUBLIC=(/ /catalog /catalog/clinic-ai-administrator /about /how-we-work /privacy /request /consultant
  /robots.txt /sitemap.xml /icon.svg /favicon.ico /apple-icon.png /og-image.png ${DEMO_IMG:+/demo/$DEMO_IMG})
PROTECTED=(/admin /admin/login /api/admin/dashboard /miniapp /api/miniapp/clinic)
CLOSED=(/ui /api /api/requests /api/consultant /.env /.git/config /server-status)

snapshot() { # «путь=код» для защищённых адресов — до и после должны совпасть
  local p
  for p in "${PROTECTED[@]}"; do printf '%s=%s\n' "$p" "$(code "$p")"; done
}

diagnose() {
  say "== диагностика: $HOST"
  nginx -t >"$TMP/nginx-t.txt" 2>&1 || { cat "$TMP/nginx-t.txt"; die "nginx -t не проходит — сначала исправьте текущую конфигурацию"; }
  grep -iE "warn|conflicting" "$TMP/nginx-t.txt" | sed 's/^/    nginx -t: /' || true
  nginx -T >"$TMP/dump.txt" 2>/dev/null
  "$NODE" "$TMP/nginx.mjs" analyze "$TMP/dump.txt" "$HOST" >"$TMP/analysis.json"
  ANALYSIS=$(cat "$TMP/analysis.json")
  say "загруженные файлы конфигурации:"
  grep -E '^# configuration file ' "$TMP/dump.txt" | sed -E 's/^# configuration file (.+):/    \1/'
  say "sites-enabled:"
  ls -l "$NGINX_DIR/sites-enabled" 2>/dev/null | tail -n +2 | awk '{print "    " $9, $10, $11}'
  "$NODE" -e '
    const a = JSON.parse(process.argv[1]);
    const host = process.argv[2], avail = process.argv[3];
    console.log(`    блоков server для ${host}:443 — ${a.found.length}`);
    a.found.forEach((s, i) => {
      console.log(`    ${i === 0 ? "ДЕЙСТВУЕТ" : "игнорируется"}: ${s.file}:${s.line}${s.real !== s.file ? ` (→ ${s.real})` : ""}`);
      if (s.serverReturn.length) console.log(`      return на уровне server: ${s.serverReturn.join("; ")}`);
      for (const l of s.locations) console.log(`      location ${l.args}${l.proxy ? ` → ${l.proxy}` : ""}${l.closedRoot ? "  [return 404]" : ""}`);
    });
    const causes = [];
    if (a.found.length === 0) causes.push(`для ${host} нет server-блока на 443 — запросы обслуживает default_server: ${a.defaults.join(", ") || "первый блок на 443"}`);
    if (a.found.length > 1) causes.push(`для ${host} несколько server-блоков на 443: nginx использует первый (${a.found[0].file}:${a.found[0].line}), правки в остальных не действуют`);
    const eff = a.found[0];
    if (eff && eff.real !== avail) causes.push(`действующий блок находится в ${eff.real}, а не в ${avail}: правка sites-available не загружается (копия файла, а не ссылка, или другой файл)`);
    if (eff && eff.serverReturn.length) causes.push("return на уровне server выполняется раньше любых location — location = / не помогает");
    if (eff && !eff.serverReturn.length && eff.locations.some((l) => l.closedRoot)) causes.push("в действующем блоке location / { return 404; }: всё, кроме /admin, /_next и /miniapp, закрыто; одного location = / мало — без /catalog, /privacy, /demo/*, иконок и robots.txt сайт неполный");
    console.log("    причина 404:\n" + causes.map((c) => `      - ${c}`).join("\n"));
  ' "$ANALYSIS" "$HOST" "$(realpath -m "$NGINX_DIR/sites-available/clinic-admin")"
  local root
  root=$(body / | head -c 4000)
  if [[ $root == *"<center>nginx"* ]]; then say "сейчас / → $(code /): ответ самого nginx (страница 404 nginx), до приложения запрос не доходит"; else say "сейчас / → $(code /)"; fi
}

effective_file() { "$NODE" -e 'const a=JSON.parse(process.argv[1]);process.stdout.write(a.found[0]?.real??"")' "$ANALYSIS"; }
upstream() { # proxy_pass существующего location (/miniapp или /admin) — тот же адрес приложения
  "$NODE" -e '
    const a=JSON.parse(process.argv[1]); const l=(a.found[0]?.locations??[]).find((x)=>x.proxy&&/miniapp|admin/.test(x.args));
    process.stdout.write(l?.proxy??"")' "$ANALYSIS"
}

write_snippet() {
  mkdir -p "$(dirname "$SNIPPET")"
  cat >"$SNIPPET" <<EOF
# Публичные страницы продающего сайта «Демо-Мед» — deploy/site-publish.sh.
# Подключается вместо «location / { return 404; }». Всё, что не перечислено здесь
# и в соседних location (/admin, /api/admin, /_next, /miniapp, /api/miniapp), — 404.
location = / {
  proxy_pass $UPSTREAM;
  include $NGINX_DIR/snippets/demo-med-proxy.conf;
}
location ~ ^/(catalog|consultant|how-we-work|about|privacy|request)(/|\$) {
  proxy_pass $UPSTREAM;
  include $NGINX_DIR/snippets/demo-med-proxy.conf;
}
location ~ ^/(robots\.txt|sitemap\.xml|icon\.svg|favicon\.ico|apple-icon\.png|og-image\.png)\$ {
  proxy_pass $UPSTREAM;
  include $NGINX_DIR/snippets/demo-med-proxy.conf;
}
location ~ ^/demo/[A-Za-z0-9._-]+\$ {
  proxy_pass $UPSTREAM;
  include $NGINX_DIR/snippets/demo-med-proxy.conf;
}
location / { return 404; }
EOF
  cat >"$NGINX_DIR/snippets/demo-med-proxy.conf" <<'EOF'
# Заголовки как у остальных location приложения (docs/admin-panel-deploy.md).
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host "";
EOF
}

restore() { # $1 — код выхода (по умолчанию 1: откат после ошибки)
  say "ОТКАТ: восстанавливаю конфигурацию nginx из $BK"
  cp -p "$BK/target.conf" "$TARGET"
  rm -f "$SNIPPET" "$NGINX_DIR/snippets/demo-med-proxy.conf"
  [[ -f $BK/snippet.conf ]] && cp -p "$BK/snippet.conf" "$SNIPPET"
  [[ -f $BK/proxy.conf ]] && cp -p "$BK/proxy.conf" "$NGINX_DIR/snippets/demo-med-proxy.conf"
  if nginx -t >/dev/null 2>&1; then
    reload_nginx
    sleep 2
    snapshot >"$BK/protected-rollback.txt"
    if diff -q "$BK/protected-before.txt" "$BK/protected-rollback.txt" >/dev/null; then
      say "ОТКАТ ВЫПОЛНЕН: конфигурация прежняя, /admin и /miniapp отвечают как до запуска"
    else
      say "ОТКАТ ВЫПОЛНЕН, но ответы отличаются — проверьте вручную:"
      diff "$BK/protected-before.txt" "$BK/protected-rollback.txt" || true
    fi
  else
    say "ВНИМАНИЕ: после восстановления nginx -t не проходит; nginx не перезагружался и работает со старой конфигурацией. Копия: $BK"
  fi
  exit "${1:-1}"
}

case $MODE in
check)
  diagnose
  say "Ничего не изменено. Публикация: sudo bash $0 apply $HOST"
  ;;
apply)
  diagnose
  TARGET=$(effective_file)
  [[ -n $TARGET && -f $TARGET ]] || die "не найден server-блок для $HOST на 443 — автоматически публиковать некуда"
  UPSTREAM=$(upstream)
  [[ $UPSTREAM =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] || die "не найден адрес приложения (proxy_pass у /admin или /miniapp): «$UPSTREAM»"
  snapshot >"$BK/protected-before.txt"
  say "защищённые адреса до изменения:"
  sed 's/^/    /' "$BK/protected-before.txt"
  grep -q '=200$' <(grep '^/admin/login=' "$BK/protected-before.txt") || die "/admin/login не отвечает 200 до изменения — сначала разберитесь с панелью"

  # Копии: изменяемый файл, сниппеты, весь каталог nginx.
  cp -p "$TARGET" "$BK/target.conf"
  [[ -f $SNIPPET ]] && cp -p "$SNIPPET" "$BK/snippet.conf"
  [[ -f $NGINX_DIR/snippets/demo-med-proxy.conf ]] && cp -p "$NGINX_DIR/snippets/demo-med-proxy.conf" "$BK/proxy.conf"
  tar -C "$(dirname "$NGINX_DIR")" -czf "$BK/nginx.tgz" "$(basename "$NGINX_DIR")"
  echo "$TARGET" >"$BK/target.path"
  echo "$HOST" >"$BK/host"
  cp "${BASH_SOURCE[0]}" "$BK/site-publish.sh"
  say "копия nginx: $BK (изменяемый файл: $TARGET, приложение: $UPSTREAM)"

  trap 'say "ошибка на строке $LINENO"; restore' ERR
  write_snippet
  RESULT=$("$NODE" "$TMP/nginx.mjs" patch "$TARGET" "$HOST" "$SNIPPET") || {
    trap - ERR
    case $RESULT in
    SERVER_RETURN) say "в действующем блоке return на уровне server — автоматическая правка небезопасна" ;;
    ROOT_NOT_404) say "location / в действующем блоке не «return 404» — неизвестная конфигурация, правлю только вручную" ;;
    *) say "правка не выполнена: $RESULT" ;;
    esac
    restore
  }
  say "изменение: $RESULT (location / → include $SNIPPET)"
  nginx -t >"$TMP/nginx-t2.txt" 2>&1 || {
    cat "$TMP/nginx-t2.txt"
    restore
  }
  reload_nginx
  sleep 2

  FAIL=0
  say "проверки после перезагрузки:"
  for p in "${PUBLIC[@]}"; do
    c=$(code "$p")
    printf '    публичный %-34s %s\n' "$p" "$c"
    [[ $c == 200 ]] || FAIL=1
  done
  HOME_HTML=$(body /)
  ASSET=$(grep -oE '/_next/static/[^"'"'"' )]+\.(css|js)' <<<"$HOME_HTML" | head -1 || true)
  if [[ -n $ASSET ]]; then
    c=$(code "$ASSET")
    printf '    ресурс    %-34s %s\n' "/_next/static/…" "$c"
    [[ $c == 200 ]] || FAIL=1
  else
    say "    на главной не найден /_next/static — проверка ресурсов не выполнена"
    FAIL=1
  fi
  if [[ $HOME_HTML != *"ИИ-администратор"* || $HOME_HTML == *"<center>nginx"* ]]; then
    say "    главная отдаёт не страницу сайта"
    FAIL=1
  fi
  for p in "${CLOSED[@]}"; do
    c=$(code "$p")
    printf '    закрытый  %-34s %s\n' "$p" "$c"
    [[ $c == 404 ]] || FAIL=1
  done
  snapshot >"$BK/protected-after.txt"
  if diff -q "$BK/protected-before.txt" "$BK/protected-after.txt" >/dev/null; then
    say "    /admin, /api/admin, /miniapp, /api/miniapp — ответы как до изменения"
  else
    say "    защищённые адреса изменились:"
    diff "$BK/protected-before.txt" "$BK/protected-after.txt" | sed 's/^/      /' || true
    FAIL=1
  fi
  [[ $FAIL == 0 ]] || restore
  trap - ERR
  say "ГОТОВО: сайт опубликован — https://$HOST/"
  say "откат: sudo bash $BK/site-publish.sh rollback $BK"
  ;;
rollback)
  BK=${2:-}
  [[ -f $BK/target.path && -f $BK/target.conf && -f $BK/host ]] || die "укажите каталог копии: rollback $BACKUPS/site-…"
  TARGET=$(cat "$BK/target.path")
  HOST=$(cat "$BK/host")
  snapshot >"$BK/protected-before.txt"
  restore 0
  ;;
*) die "режим: check | apply [домен] | rollback <каталог>" ;;
esac
