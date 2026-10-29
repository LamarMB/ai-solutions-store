#!/usr/bin/env bash
# Экземпляр «Демо-Мед» для новой клиники на сервере (docs/clinic-instance-deploy.md).
# Запускать от root из каталога выпуска (/opt/demo-med/current). Исходный код не
# меняется; секреты не печатаются; существующие клиники и файлы не перезаписываются.
#
#   new-clinic.sh create <id> <порт> <домен>  пользователь dm-<id>, каталоги, файл настроек
#   new-clinic.sh check  <id>                 проверка настроек и конфликтов с другими клиниками
#   new-clinic.sh nginx  <id> [--http-only]   конфигурация nginx (http-only — до сертификата)
#   new-clinic.sh owner  <id> <логин>         первая учётная запись панели (роль owner)
#   new-clinic.sh start  <id> panel|bot       проверка, затем запуск панели или бота
#                                             (бот в live — после заполнения справочника)
#   new-clinic.sh vk     <id>                 проверка ключа сообщества и Long Poll (ничего не отправляет)
#   new-clinic.sh status <id>                 состояние сервисов и последние строки журналов
#
# Резервные копии (docs/backup-restore.md):
#   new-clinic.sh backup-init   <id>          файл настроек копий с новым BACKUP_KEY
#   new-clinic.sh backup-check  <id>          проверка настроек копий
#   new-clinic.sh backup-enable <id>          ежедневный таймер
#   new-clinic.sh backup        <id>          копия сейчас (тот же сервис, что у таймера)
#   new-clinic.sh backups       <id>          список копий во внешнем хранилище
#   new-clinic.sh backup-verify <id> [копия]  проверка восстановлением, рабочая база не трогается
#   new-clinic.sh restore       <id> <копия>  расшифровка в НОВЫЙ файл в каталоге клиники
#   new-clinic.sh restore-apply <id> <файл> --confirm=<id>
#                                             замена рабочей базы восстановленной (прежняя сохраняется)
set -euo pipefail
umask 077

APP_DIR=/opt/demo-med/current
CONF_DIR=/etc/demo-med/clinics
DATA_ROOT=/var/lib/demo-med
BACKUP_ROOT=/var/backups/demo-med
BACKUP_CONF=/etc/demo-med/backup
NGINX_DIR=/etc/nginx/sites-available
NGINX_ENABLED=/etc/nginx/sites-enabled
NODE=/usr/bin/node
TOOL=("$NODE" "$APP_DIR/node_modules/tsx/dist/cli.mjs" "$APP_DIR/scripts/clinic-instance.mts")

die() { echo "Ошибка: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "запустите от root (sudo)"
# tsx берёт пути @/… из tsconfig.json каталога запуска.
cd "$APP_DIR"
cmd=${1:-}; id=${2:-}
[[ $id =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]] || die "идентификатор клиники: латиница, цифры, дефис (3–32)"
user="dm-$id"
env_file="$CONF_DIR/$id.env"
backup_env="$BACKUP_CONF/$id.env"
db="$DATA_ROOT/$id/bot.sqlite"
BACKUP_TOOL=("$NODE" "$APP_DIR/node_modules/tsx/dist/cli.mjs" "$APP_DIR/scripts/clinic-backup.mts")

# Команда приложения от имени клиники: её пользователь, её настройки (их читает
# systemd, в аргументы и журнал значения не попадают).
as_clinic() {
  local tty=--pipe
  [[ ${1:-} == --pty ]] && { tty=--pty; shift; }
  systemd-run --quiet "$tty" --wait --collect --uid="$user" --gid="$user" \
    --working-directory="$APP_DIR" -p EnvironmentFile="$env_file" -p UMask=0077 \
    "$NODE" node_modules/tsx/dist/cli.mjs "$@"
}

# Команда копирования от имени клиники: только настройки копий, не секреты бота.
as_backup() {
  systemd-run --quiet --pipe --wait --collect --uid="$user" --gid="$user" \
    --working-directory="$APP_DIR" -p EnvironmentFile="$backup_env" \
    -p Environment="CLINIC_ID=$id" -p Environment="BOT_DB_PATH=$db" -p UMask=0077 \
    "$NODE" node_modules/tsx/dist/cli.mjs scripts/clinic-backup.mts "$@"
}

check() {
  "${TOOL[@]}" check --env="$env_file" --others="$CONF_DIR" --app="$APP_DIR" --data-root="$DATA_ROOT" "$@"
}

case "$cmd" in
  create)
    port=${3:-}; domain=${4:-}
    [[ -n $port && -n $domain ]] || die "create <id> <порт> <домен>"
    [[ ! -e $env_file ]] || die "клиника $id уже создана ($env_file)"
    [[ ! -e $DATA_ROOT/$id ]] || die "каталог данных $DATA_ROOT/$id уже существует"
    ! id -u "$user" >/dev/null 2>&1 || die "пользователь $user уже существует"
    # Настройки читает только root (systemd передаёт их сервисам). Каталоги данных:
    # 711 — клиники не видят списка друг друга, каждая — только свой каталог 700.
    install -d -m 0755 -o root -g root /etc/demo-med
    install -d -m 0700 -o root -g root "$CONF_DIR"
    install -d -m 0711 -o root -g root "$DATA_ROOT" "$BACKUP_ROOT"
    # Файл настроек: порт и домен проверяются на совпадение с другими клиниками.
    "${TOOL[@]}" init --id="$id" --port="$port" --domain="$domain" \
      --out="$env_file" --others="$CONF_DIR" --data-root="$DATA_ROOT"
    useradd --system --user-group --no-create-home --home-dir "$DATA_ROOT/$id" \
      --shell /usr/sbin/nologin "$user"
    install -d -m 0700 -o "$user" -g "$user" "$DATA_ROOT/$id" "$BACKUP_ROOT/$id"
    chown root:root "$env_file"
    chmod 0600 "$env_file"
    echo "Создано: $user, $DATA_ROOT/$id (700), $BACKUP_ROOT/$id (700), $env_file (600, root)."
    echo "Дальше: заполните $env_file (sudoedit), затем: $0 check $id"
    ;;
  check)
    check
    ;;
  nginx)
    [[ -e $env_file ]] || die "нет $env_file"
    target="$NGINX_DIR/demo-med-$id.conf"
    "${TOOL[@]}" nginx --env="$env_file" ${3:-} > "$target.new"
    chmod 0644 "$target.new"
    [[ -e $target ]] && cp -p "$target" "$target.prev"
    mv "$target.new" "$target"
    ln -sf "$target" "$NGINX_ENABLED/demo-med-$id.conf"
    install -d -m 0755 /var/www/letsencrypt
    # Ошибка конфигурации — возвращаем прежнюю, работающие клиники не страдают.
    if ! nginx -t; then
      if [[ -e $target.prev ]]; then mv "$target.prev" "$target"
      else rm -f "$target" "$NGINX_ENABLED/demo-med-$id.conf"; fi
      die "nginx -t не прошёл — изменения отменены (нет сертификата? сначала --http-only)"
    fi
    rm -f "$target.prev"
    systemctl reload nginx
    echo "nginx: $target"
    if [[ ${3:-} == --http-only ]]; then
      echo "Сертификат: certbot certonly --webroot -w /var/www/letsencrypt -d <домен>, затем: $0 nginx $id"
    fi
    ;;
  owner)
    login=${3:-}
    [[ $login =~ ^[a-zA-Z0-9._-]{3,64}$ ]] || die "owner <id> <логин>"
    # Тот же пользователь и окружение, что у сервисов; пароль вводится скрыто.
    as_clinic --pty scripts/admin-user.mts create "$login" --role=owner
    ;;
  start)
    what=${3:-}
    case "$what" in
      panel) check --port-free ;;
      bot) check ;;
      *) die "start <id> panel|bot" ;;
    esac
    systemctl daemon-reload
    systemctl enable --now "demo-med-$what@$id"
    sleep 3
    systemctl --no-pager --lines=0 status "demo-med-$what@$id" || true
    ;;
  vk)
    # bot:setup не используется: он пишет .env.local в каталог приложения.
    as_clinic scripts/vk-check.mts
    ;;
  backup-init)
    [[ -e $env_file ]] || die "сначала create"
    install -d -m 0700 -o root -g root "$BACKUP_CONF"
    "${BACKUP_TOOL[@]}" init --id="$id" --out="$backup_env"
    echo "Дальше: sudoedit $backup_env (BACKUP_TARGET, доступ к хранилищу), затем: $0 backup-check $id"
    ;;
  backup-check)
    CLINIC_ID="$id" BOT_DB_PATH="$db" "${BACKUP_TOOL[@]}" check \
      --env="$backup_env" --clinic-env="$env_file" --others="$BACKUP_CONF"
    ;;
  backup-enable)
    CLINIC_ID="$id" BOT_DB_PATH="$db" "${BACKUP_TOOL[@]}" check \
      --env="$backup_env" --clinic-env="$env_file" --others="$BACKUP_CONF"
    systemctl daemon-reload
    systemctl enable --now "demo-med-backup@$id.timer"
    systemctl list-timers --no-pager "demo-med-backup@$id.timer"
    ;;
  backup)
    # Тот же сервис, что запускает таймер: те же права и журнал.
    systemctl start "demo-med-backup@$id.service" || true
    journalctl --no-pager -n 15 -u "demo-med-backup@$id.service"
    systemctl is-failed --quiet "demo-med-backup@$id.service" && die "копия не создана (см. журнал выше)"
    ;;
  backups)
    as_backup list
    ;;
  backup-verify)
    as_backup verify ${3:+--name="$3"}
    ;;
  restore)
    name=${3:-}
    [[ $name =~ ^demo-med-$id-[0-9]{8}T[0-9]{6}Z\.dmbk$ ]] || die "restore <id> <имя копии из списка backups>"
    out="$DATA_ROOT/$id/restore-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
    as_backup restore --name="$name" --out="$out"
    echo "Восстановлено в $out. Замена рабочей базы: $0 restore-apply $id $out --confirm=$id"
    ;;
  restore-apply)
    file=${3:-}
    [[ ${4:-} == "--confirm=$id" ]] || die "restore-apply <id> <файл> --confirm=<id> — подтверждение обязательно"
    [[ $file == "$DATA_ROOT/$id/restore-"*.sqlite && -f $file ]] || die "файл восстановления должен быть в $DATA_ROOT/$id (команда restore)"
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    systemctl stop "demo-med-bot@$id" "demo-med-panel@$id" "demo-med-backup@$id.timer"
    # Прежняя база не удаляется — переименовывается рядом.
    for suffix in "" -wal -shm; do
      [[ -e $db$suffix ]] && mv "$db$suffix" "$db$suffix.before-restore-$stamp"
    done
    mv "$file" "$db"
    chown "$user:$user" "$db"
    chmod 0600 "$db"
    systemctl start "demo-med-panel@$id" "demo-med-bot@$id" "demo-med-backup@$id.timer"
    echo "База заменена. Прежняя: $db.before-restore-$stamp. Проверьте панель и бота."
    ;;
  status)
    systemctl --no-pager --lines=0 status "demo-med-bot@$id" "demo-med-panel@$id" || true
    journalctl --no-pager -n 20 -u "demo-med-bot@$id" -u "demo-med-panel@$id"
    ;;
  *)
    die "команды: create, check, nginx, owner, start, vk, status, backup-init, backup-check, backup-enable, backup, backups, backup-verify, restore, restore-apply"
    ;;
esac
