# Память проекта — точка входа

Краткая сводка для старта новой сессии. Читается вместе с `AGENTS.md`; остальное — по
ссылкам и только при необходимости. Обновлять после каждого существенного этапа.
Секретов, паролей, ключей, медицинских и персональных данных здесь нет и быть не должно.

Актуально на редизайн VK Mini App (коммит, следующий за `ba416f0`).
Перед работой сверить с Git: `git log --oneline -5`.

## Продукт

- **Публичный сайт** — витрина ИИ-решений для частных медицинских клиник (Next.js).
  Демо: заявки в тестовом режиме, консультант на правилах, индексация выключена.
- **VK-бот «ИИ-администратор»** вымышленной клиники «Демо-Мед»: разговор (GPT или
  правила), подбор специалиста, запись и отмена по тестовому расписанию, проверка
  тревожных признаков. Меню — три действия: «Открыть приложение» (Mini App 54834865),
  «Мои записи», «Администратор»; остальное — текстом. Обращение к администратору —
  дословный текст пациента с предпросмотром и явным согласием. Канал — сообщения
  сообщества ВКонтакте (Bots Long Poll). Отвечает только тестовым аккаунтам.
- **Админ-панель клиники** `/admin`: записи, врачи, расписание, настройки, сотрудники и
  роли, «Мои приёмы» врача, «Обращения» (роль admin), журнал доступа.
- **VK Mini App** `/miniapp`: врачи и карточка врача, свободное время, запись, отмена и
  перенос, услуги с поиском, о клинике — внутри ВКонтакте, по подписанным параметрам
  запуска, только тестовым аккаунтам. Дизайн «премиальная частная клиника» (Р-16). Та же
  база и расписание, что у бота и панели.
- Все данные клиники и пациентов — вымышленные. Реальные персональные данные не
  собираются до правовой оценки.

## Компоненты и код

| Компонент                   | Где                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ядро бота (без VK и LLM)    | `src/bot/bot.ts` (`createBot`), `src/bot/index.ts` (`createDemoBot`)                                                                                       |
| Разговор и безопасность     | `src/bot/conversation/` — `orchestrator.ts`, `safety.ts`, `scope.ts`, `triage.ts`, `guard.ts`, `memory.ts`                                                 |
| Шаги записи и кнопки        | `src/bot/dialog/` — `dialog.ts`, `types.ts` (действия, состояния, `ConsentPort`)                                                                           |
| GPT (OpenAI Responses API)  | `src/bot/llm/` — `openai-conversation.ts`, `openai-client.ts`                                                                                              |
| Канал ВКонтакте             | `src/bot/vk/` — `longpoll.ts`, `runner.ts` (уведомление администратору), `keyboard.ts`                                                                     |
| Расписание                  | `src/bot/schedule/schedule.ts` (`ClinicSchedule`)                                                                                                          |
| SQLite                      | `src/bot/storage/sqlite.ts` (`SqliteStore`, миграции), `clinic-store.ts`, `admin-store.ts`, `consent-store.ts`, `medical-crypto.ts`                        |
| Согласия и обращения (бот)  | `src/bot/consent.ts` (порты), `src/bot/storage/request-store.ts`                                                                                           |
| Настройки (env, Zod)        | `src/bot/config.ts`                                                                                                                                        |
| API панели                  | `src/app/api/admin/[...path]/route.ts` → `src/admin/api.ts` (`ROUTES`)                                                                                     |
| Роли и права                | `src/admin/permissions.ts`; страницы — `requirePage` в `src/admin/server.ts`                                                                               |
| Операции панели             | `src/admin/service.ts`, `src/admin/staff.ts`, проверка данных — `src/admin/schemas.ts`                                                                     |
| Вход и сессии               | `src/admin/auth.ts`, `src/admin/password.ts`                                                                                                               |
| Страницы и интерфейс панели | `src/app/admin/`, `src/components/admin/`                                                                                                                  |
| VK Mini App                 | страница `src/app/miniapp/`, интерфейс `src/components/miniapp/`, API `src/app/api/miniapp/` → `src/miniapp/` (`api.ts`, `service.ts`, `launch-params.ts`) |
| Публичный сайт              | `src/app/(site)/`, `src/catalog/`, `src/content/`, `src/consultant/`, `src/requests/`                                                                      |
| Команды обслуживания        | `scripts/` — `vk-bot.mts`, `vk-check.mts`, `admin-user.mts`, `db-backup.mts`, `bot-sim.mts`                                                                |

Схема компонентов и потоков — [architecture.md](architecture.md).

## SQLite

- Один файл `BOT_DB_PATH` (по умолчанию `.data/bot.sqlite`, вне Git) для бота, панели и
  Mini App,
  режим WAL. Миграции — `PRAGMA user_version`, список `MIGRATIONS` в `sqlite.ts`,
  применяются автоматически при открытии базы.
- **Версия схемы: v8** — в коде и на VPS.
- v1–v3 — записи, сессии, счётчики; v4 — справочники клиники, статусы записей; v5 —
  админ-панель; v6 — роли, приглашения, согласия врачу, журнал доступа; v7 — обращения
  пациентов к администратору (`patient_requests`, `request_access_log`); v8 — фото врачей
  (`doctor_photos`, BLOB; демо-портреты ИИ — только `npm run doctors:demo-photos`).

## Роли (кратко)

`owner` — сотрудники, настройки, все организационные разделы; `admin` — записи, врачи,
расписание, «Обращения»; `doctor` — только свои приёмы. Медицинские сведения не
открывает ни одна роль сама по себе: врач видит краткое описание жалобы только своей
записи и только по согласию пациента; администратор — только текст обращения, который
пациент увидел и разрешил передать. Подробно — [medical-privacy.md](medical-privacy.md).

## Состояние

- На VPS: `main`, `47323c6`, Next.js 16.4.2, схема v8 (развёрнуто 25.10.2026, точка
  отката и копия базы сохранены). Запись в боте и Mini App владелец подтвердил; вход в
  панель после обновления не подтверждён.
- Подробно, с известными проблемами — [current-status.md](current-status.md).

## Главные ограничения

- **Руководители сообщества ВКонтакте видят всю переписку пациента.** Не решено; перенос
  медицинского чата на отдельный сайт владелец сейчас отклонил. Нельзя заявлять, что
  переписка скрыта. Решения и причины — [decisions.md](decisions.md).
- Из облачного окружения недоступны `api.vk.com` и `api.openai.com`: живые проверки
  ВКонтакте и OpenAI делаются только на VPS или компьютере владельца.
- Основная среда владельца — Windows; CI проверяет Ubuntu и Windows.

## Как безопасно обновлять сервер

Только по решению владельца: резервная копия (`npm run db:backup`) → `git pull` →
`npm ci` → тесты `src/bot src/admin` → сборка с `NODE_OPTIONS=--max-old-space-size=1024` →
перезапуск бота и панели → проверка. Текущая версия целиком —
[bot-menu-requests-deploy.md](bot-menu-requests-deploy.md); подробности: этап 2 —
[privacy-update-vps.md](privacy-update-vps.md), Mini App —
[vk-mini-app-deploy.md](vk-mini-app-deploy.md).

## Подробная документация

| Тема                                    | Документ                                                         |
| --------------------------------------- | ---------------------------------------------------------------- |
| Правила бота и панели                   | [rules/bot-and-panel.md](rules/bot-and-panel.md)                 |
| Правила публичного сайта                | [rules/site.md](rules/site.md)                                   |
| Архитектура                             | [architecture.md](architecture.md)                               |
| Решения и отклонённые варианты          | [decisions.md](decisions.md)                                     |
| Текущее состояние и следующий этап      | [current-status.md](current-status.md)                           |
| Конфиденциальность, роли, согласия      | [medical-privacy.md](medical-privacy.md)                         |
| Обновление VPS до этапа 2               | [privacy-update-vps.md](privacy-update-vps.md)                   |
| VK Mini App: ВКонтакте, VPS, nginx      | [vk-mini-app-deploy.md](vk-mini-app-deploy.md)                   |
| Меню бота, обращения: обновление VPS    | [bot-menu-requests-deploy.md](bot-menu-requests-deploy.md)       |
| Развёртывание панели, nginx, память VPS | [admin-panel-deploy.md](admin-panel-deploy.md)                   |
| Обновление и проверка разговорного бота | [conversational-bot-deploy.md](conversational-bot-deploy.md)     |
| Запуск бота, настройка сообщества       | [vk-bot-run.md](vk-bot-run.md), [vk-bot-plan.md](vk-bot-plan.md) |
| Этапы (длинный, искать поиском)         | [roadmap.md](roadmap.md)                                         |
| Готовность к production сайта           | [production-readiness.md](production-readiness.md)               |
