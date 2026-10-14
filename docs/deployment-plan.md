# План развёртывания

Инструкция для будущего запуска. **Сейчас ничего не развёрнуто**: развёртывание —
отдельным решением владельца после блокеров K1–K7 из
[production-readiness.md](production-readiness.md).

## 1. Требования приложения

- Node.js 24 LTS, постоянно работающий процесс `next start`: Server Actions (заявка,
  консультант) и динамические страницы (`/catalog`, `/request`) требуют сервера —
  статический экспорт не подходит.
- **Один инстанс.** Ограничение частоты и ключи повторной отправки хранятся в памяти
  процесса. Несколько инстансов или serverless с автоскейлингом ослабят защиту, пока
  счётчик не перенесён в общее хранилище.
- Reverse proxy с https, который **перезаписывает** `X-Forwarded-For` и `X-Real-IP`
  адресом клиента — приложение берёт последний адрес из `X-Forwarded-For`.
- Переменные **при сборке**: `SITE_URL`, `SITE_INDEXING` (см. [seo.md](seo.md)).
  Секретов сейчас нет; появятся вместе с БД и LLM — только в окружении сервера.
- Ресурсы: 2 vCPU, 2–4 ГБ RAM, 20–50 ГБ диска с запасом для сборки.

## 2. Варианты размещения (Россия)

Цены — ориентиры на октябрь 2026 из официальных страниц и обзоров; источники
расходятся, перед заказом проверьте в калькуляторе провайдера.

| Критерий                 | Yandex Cloud: VM + Managed PostgreSQL                                                                                                                                                                                | Timeweb Cloud: VPS                                                                                      | Selectel: облачный сервер                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Стоимость в месяц        | VM 2 vCPU / 4 ГБ — оценка 3–5 тыс. ₽; Managed PostgreSQL 2 vCPU / 4 ГБ — ≈ 4,2 тыс. ₽ за вычисления по ставкам документации (1,88 ₽/vCPU·ч, 0,51 ₽/ГБ·ч) плюс диск и бэкапы; итого ~8–11 тыс. ₽ после подключения БД | 2 vCPU / 4 ГБ / 50 ГБ NVMe (Москва) — ~1,1–1,2 тыс. ₽; БД на том же сервере или managed — дополнительно | Облачные серверы — от нескольких сотен ₽; сегмент для ПДн — цена по запросу |
| Next.js и Server Actions | Да — обычный Node.js-процесс на VM (также возможны Serverless Containers, но см. «один инстанс»)                                                                                                                     | Да — Node.js на VPS                                                                                     | Да — Node.js на сервере                                                     |
| Персональные данные      | ЦОД в РФ; есть решение «Облако 152-ФЗ» с документами для клиентов — запросить и проверить                                                                                                                            | ЦОД в РФ; заявлена инфраструктура 152-ФЗ с УЗ-1 — аттестат запросить                                    | ЦОД в РФ; заявлено облако 152-ФЗ до УЗ-1 — документы запросить              |
| Администрирование        | Средняя: VM настраивается вручную, БД и бэкапы — managed, IAM и аудит доступа есть                                                                                                                                   | Выше: ОС, обновления, БД и бэкапы — на вас                                                              | Средняя: ОС на вас, DBaaS доступна                                          |
| Резервное копирование    | Автоматические бэкапы managed-БД, снимки дисков VM по расписанию                                                                                                                                                     | Платные бэкапы VPS; бэкапы БД — настраивать самостоятельно                                              | Снимки и бэкапы как услуга; DBaaS с бэкапами                                |
| Масштабирование          | Изменение размера VM, группы ВМ, балансировщик; рост БД без переезда                                                                                                                                                 | Изменение тарифа VPS                                                                                    | Изменение конфигурации, балансировщики                                      |

Ни для одного провайдера соответствие 152-ФЗ здесь не утверждается: это заявления
провайдеров. Оператор ПДн (компания) сам отвечает за определение уровня защищённости и
меры защиты; провайдер закрывает только свою часть инфраструктуры.

### Рекомендация: Yandex Cloud (Compute VM + Managed PostgreSQL)

- Managed PostgreSQL снимает самую рискованную часть — хранение заявок с контактами:
  автоматические бэкапы, шифрование, обновления, доступ по ролям.
- Есть материалы для клиентов по 152-ФЗ и регионы в РФ — проще пройти юридическую часть.
- В том же облаке доступна YandexGPT — будущий консультант без передачи данных
  третьему провайдеру и с отключаемым логированием запросов.
- Ориентир бюджета: **~3–5 тыс. ₽/мес** на этапе витрины (только VM, без БД) и
  **~8–11 тыс. ₽/мес** после включения приёма заявок (VM + managed-БД 2 vCPU / 4 ГБ),
  без LLM. Это оценка: меньшая конфигурация БД (доля vCPU) дешевле — уточнить в
  калькуляторе Yandex Cloud.

**Бюджетная альтернатива** для запуска витрины без приёма заявок — VPS Timeweb Cloud
(~1,1–1,2 тыс. ₽/мес) по той же инструкции ниже; при включении приёма заявок — переезд
на managed-БД или самостоятельная настройка бэкапов и защиты.

## 3. Развёртывание на VM (Ubuntu 24.04 LTS)

### 3.1. Сервер

```bash
# Пользователь без root-прав для приложения
sudo adduser --system --group --home /srv/ai-solutions-store app
# Обновления безопасности
sudo apt update && sudo apt install -y unattended-upgrades nginx git
# Node.js 24 LTS из официального репозитория NodeSource или через nvm для пользователя app
node --version   # v24.x
# Файрвол: только SSH и веб
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

SSH — только по ключам, вход под root запрещён (`PermitRootLogin no`,
`PasswordAuthentication no`).

### 3.2. Сборка релиза

Каждый релиз — отдельный каталог; текущий выбирается символической ссылкой.

```bash
sudo -u app -H bash -c '
  set -euo pipefail
  REL=/srv/ai-solutions-store/releases/$(date +%Y%m%d%H%M%S)
  git clone --depth 1 --branch main <url-репозитория> "$REL"
  cd "$REL"
  npm ci
  # Индексация включается только после чек-листа (launch-checklist.md)
  SITE_URL=https://<утверждённый-домен> SITE_INDEXING=false npm run build
  ln -sfn "$REL" /srv/ai-solutions-store/current
'
sudo systemctl restart ai-solutions-store
```

Доступ к приватному репозиторию — deploy key только на чтение.

### 3.3. Сервис systemd

`/etc/systemd/system/ai-solutions-store.service`:

```ini
[Unit]
Description=AI Solutions Store (Next.js)
After=network.target

[Service]
User=app
Group=app
WorkingDirectory=/srv/ai-solutions-store/current
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
# Секреты (позже: БД, LLM) — в файле с правами 600, не в Git
EnvironmentFile=-/etc/ai-solutions-store/env
# Только локальный интерфейс: снаружи — через nginx
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/ai-solutions-store/current/.next
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ai-solutions-store
journalctl -u ai-solutions-store -f   # логи
```

### 3.4. nginx и https

`/etc/nginx/sites-available/ai-solutions-store`:

```nginx
server {
    listen 80;
    server_name <домен>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name <домен>;

    ssl_certificate     /etc/letsencrypt/live/<домен>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<домен>/privkey.pem;

    # HSTS — только после проверки, что https работает на всех поддоменах
    add_header Strict-Transport-Security "max-age=31536000" always;

    client_max_body_size 1m;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # Перезаписываем, а не дополняем: клиент не должен подставлять свой адрес
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Сертификат — Let's Encrypt (`certbot --nginx`) с автоматическим продлением. Порт 3000
снаружи закрыт: Node.js слушает только `127.0.0.1`.

### 3.5. Проверка после выкладки

```bash
curl -sI https://<домен>/ | grep -iE "strict-transport|x-frame|content-security|x-robots"
curl -s https://<домен>/robots.txt
curl -s -o /dev/null -w "%{http_code}\n" https://<домен>/catalog/clinic-ai-administrator
```

Затем — сквозные пути клиента вручную (см. `launch-checklist.md`).

### 3.6. Откат

```bash
ln -sfn /srv/ai-solutions-store/releases/<предыдущий> /srv/ai-solutions-store/current
sudo systemctl restart ai-solutions-store
```

Хранить 3–5 последних релизов, старые удалять.

## 4. Резервное копирование

- **Сейчас:** состояния нет — сайт целиком восстанавливается из Git и инструкции выше.
  Сохранять только конфигурацию сервера (`/etc/nginx`, unit-файл, `/etc/ai-solutions-store/env`
  — в менеджере секретов, не в Git).
- **После включения приёма заявок:** ежедневные бэкапы managed-БД, срок хранения по
  политике ПДн, ежеквартальная проверка восстановления на отдельной БД.

## 5. Мониторинг

- Проверка доступности главной и `/catalog` раз в 1–5 минут (средствами облака, например
  Yandex Monitoring, или внутренним скриптом) с оповещением ответственному.
- Логи `journalctl` с ротацией; в логах нет персональных данных (проверяется тестами).
- Обновления: `unattended-upgrades` для ОС; Next.js и зависимости — через PR с CI.
