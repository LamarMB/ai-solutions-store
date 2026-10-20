# Архитектура

Карта компонентов и их связей. Без пересказа кода: детали — в файлах по ссылкам, правила
— в [rules/bot-and-panel.md](rules/bot-and-panel.md) и [rules/site.md](rules/site.md).

## Общая схема

```
Пациент ── сообщения сообщества ВКонтакте ──► VK Bots Long Poll
                                                  │
                     scripts/vk-bot.mts (процесс бота, npm run bot:vk)
                                                  │
                     src/bot/vk/runner.ts ──► createBot().handle(peerId, событие)
                                                  │
              ┌───────────────────────────────────┼───────────────────────────┐
              ▼                                   ▼                           ▼
   conversation/orchestrator.ts          dialog/dialog.ts             ConsentPort (consent.ts)
   safety → scope → модель/правила       шаги записи, кнопки          согласие пациента
              │                                   │                           │
   llm/ (OpenAI, необязательно)        schedule/ClinicSchedule                │
                                                  │                           │
                                    ┌─────────────▼───────────────────────────▼──┐
                                    │  SQLite (BOT_DB_PATH, WAL) — SqliteStore   │
                                    └─────────────▲──────────────────────────────┘
                                                  │
              next start (процесс панели) ── adminDeps / miniAppDeps (тот же процесс)
                                                  │
   Сотрудник ── https ── nginx ── /admin и /api/admin/* ── src/admin/api.ts
   Пациент в приложении ВКонтакте ── https ── nginx ── /miniapp и /api/miniapp/*
        (заголовок X-VK-Launch-Params, подпись) ── src/miniapp/api.ts
```

Бот и панель — **разные процессы** с одним файлом SQLite. Отдельных хранилищ записей и
копий справочников нет: изменения из панели бот видит со следующего сообщения.

## VK-бот

- **Канал** — `src/bot/vk/`: Long Poll (`longpoll.ts`), разбор событий, отправка ответов,
  клавиатуры (`keyboard.ts`, лимиты ВКонтакте), фильтр `VK_ALLOWED_USER_IDS`, защита от
  повторных событий. `VkAdminNotifier` (`runner.ts`) шлёт администратору только ссылку
  на диалог.
- **Меню** — `show({ step: "menu" })` в `dialog.ts`: «Открыть приложение» (действие
  `app`; `keyboard.ts` превращает его в кнопку `open_app` Mini App или, если её нельзя,
  в «Записаться на приём»), «Мои записи», «Администратор».
- **Обращение к администратору** — шаги `handoff_compose` → `handoff_consent`:
  дословный текст пациента, предпросмотр, согласие кнопкой с меткой SHA-256 текста →
  `RequestPort.create` (`src/bot/consent.ts`) → `RequestStore` (`patient_requests`,
  шифрование, хэш, триггеры неизменности) и эффект handoff (пауза бота и уведомление
  администратору со ссылкой и номером обращения, без текста). Отзыв (`hrv`, «отозвать
  передачу») обрабатывается и во время паузы.
- **Ядро** — `src/bot/bot.ts`: пауза после передачи администратору, ограничение частоты
  (`guard.ts`), загрузка и сохранение состояния, эффекты (handoff), счётчики.
  `createDemoBot` (`src/bot/index.ts`) собирает всё над `SqliteStore`.
- **Порядок обработки текста** (`orchestrator.ts`): кнопки и «да/нет» без модели →
  правила тревожных признаков (`safety.ts`) → фильтр темы (`scope.ts`) → модель или
  правила (`triage.ts`, `rule-interpreter.ts`) → выполнение через расписание.
- **Запись** — `dialog.ts` + `ClinicSchedule`: только кнопкой «Подтвердить» или «да» на
  шаге подтверждения; данные — из сохранённого состояния.
- **Память разговора** — `memory.ts`: жалоба, ответы на уточнения, 12 реплик; хранится в
  `sessions`, удаляется по сроку и командой «сброс».

## GPT

- `src/bot/llm/`: Responses API через `fetch`, без SDK, Structured Outputs. Модель
  возвращает действие из `MODEL_ACTIONS` и короткий ответ; `sanitizeDecision` проверяет
  id, даты и текст; опасные ответы отбрасываются (`isUnsafeReply`).
- Модель не может записать, отменить или снизить срочность. Ошибка, лимит, неверный JSON
  или отсутствие ключа — тот же разговор по правилам.
- Модель получает текст сообщения (телефоны и почта вырезаны) и краткую память.

## SQLite

- `src/bot/storage/sqlite.ts` — `SqliteStore`: записи (уникальный индекс по активному
  слоту против двойной записи), сессии, паузы, события, счётчики, миграции
  (`MIGRATIONS`, `PRAGMA user_version`, каждая в `BEGIN IMMEDIATE`).
- Подхранилища: `clinic` (`clinic-store.ts` — врачи, специальности, часы, исключения,
  услуги, настройки; кэш до изменения базы), `admin` (`admin-store.ts` — сотрудники,
  сессии, приглашения, аудит), `consents` (`consent-store.ts` — согласия врачу и журнал
  доступа), `requests` (`request-store.ts` — обращения к администратору и журнал доступа).
- `medical-crypto.ts` (`MedicalCipher`, AES-256-GCM с контекстом): при заданном
  `MEDICAL_DATA_KEY` шифрует `sessions.state` и содержимое согласий.
- Текущая версия схемы — `SCHEMA_VERSION` (v7). Резервная копия — `npm run db:backup`.

## Админ-панель

- Страницы `src/app/admin/`: `login`, `invite` (вне сессии), группа `(panel)` — проверка
  сессии в `layout.tsx`, права каждой страницы — `requirePage(...)`.
- API: один обработчик `src/app/api/admin/[...path]/route.ts` → `handleAdminApi`
  (`src/admin/api.ts`): Origin и JSON для изменений → вход/приглашение → сессия →
  таблица `ROUTES` (маршрут → право) → `AdminService` / `StaffService`.
- Вход: scrypt, cookie `__Host-admin_session`, в базе SHA-256 токена, ограничение
  попыток (`auth.ts`). Учётные записи — `npm run admin:user` или приглашения.
- Интерфейс: `src/components/admin/` (клиент ходит в API через `client.ts`).

## VK Mini App

- Страница `/miniapp` (`src/app/miniapp/`, клиент `src/components/miniapp/`): светлая
  тема `.theme-miniapp` (токены в `globals.css`), нижняя навигация, экраны — главная,
  врачи, запись, мои записи, услуги, о клинике. `VKWebAppInit` — официальный VK Bridge.
  Вне ВКонтакте — пояснение без запросов данных.
- Клиент отправляет строку параметров запуска как есть в заголовке `X-VK-Launch-Params`;
  `handleMiniAppApi` проверяет подпись (`launch-params.ts`), приложение, срок `vk_ts`,
  список тестовых аккаунтов и частоту; пациент — `vk_user_id` подписи. Cookie нет.
- `MiniAppService` (`src/miniapp/service.ts`) — над `ClinicSchedule` и `SqliteStore` с
  правилами пациента: свободные дни и слоты, запись (`source: miniapp`, повтор
  возвращает ту же запись), отмена и перенос только своей записи. Ответы — только
  организационные поля.
- Встраивание во фрейм: `/miniapp` — только домены ВКонтакте (CSP `frame-ancestors`),
  всё остальное — `DENY` (`next.config.ts`).

## Роли и доступ

- Таблица прав — `src/admin/permissions.ts` (`PERMISSIONS`, `can`, `homeFor`).
  Проверяется на сервере для каждого маршрута и страницы; меню — только отображение.
- Медицинские сведения выдаёт один маршрут `GET my/<id>/medical` (роль `doctor`):
  запись своего врача, не отменена, действующее согласие для этого врача; каждая попытка
  — в `medical_access_log`.
- Обращения: `GET requests`, `GET requests/<id>/content`, `PATCH requests/<id>` — только
  роль `admin` (`requests.handle`); текст выдаётся при действующем согласии и совпадении
  SHA-256, каждое открытие — в `request_access_log`. Владельцу — только журнал.
- Согласие создаёт только пациент в боте: предпросмотр → «Передать врачу» →
  `ConsentStore.grantToDoctor`. Отзыв, отмена или перенос записи, срок — удаляют
  содержимое. Подробно — [medical-privacy.md](medical-privacy.md).

## Публичный сайт

Next.js App Router, группа `src/app/(site)`: каталог (`src/catalog/`, данные
`src/content/`), заявки (`src/requests/`, тестовый режим), консультант
(`src/consultant/`, правила), SEO (`src/lib/seo.ts`). С ботом и панелью общих данных нет.

## Точки входа

| Что                    | Команда / файл                                                |
| ---------------------- | ------------------------------------------------------------- |
| Бот ВКонтакте          | `npm run bot:vk` → `scripts/vk-bot.mts`                       |
| Проверка настроек бота | `npm run bot:check` → `scripts/vk-check.mts`                  |
| Симулятор бота         | `npm run bot:sim` → `scripts/bot-sim.mts`                     |
| Панель, Mini App, сайт | `npm run build` + `next start`                                |
| Сотрудники             | `npm run admin:user` → `scripts/admin-user.mts`               |
| Резервная копия базы   | `npm run db:backup` → `scripts/db-backup.mts`                 |
| Счётчики бота          | `npm run bot:stats` → `scripts/bot-stats.mts`                 |
| Тесты                  | `npm test`; бот и панель — `npx vitest run src/bot src/admin` |
