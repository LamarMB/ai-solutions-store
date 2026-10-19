# Память проекта — точка входа

Краткая сводка для старта новой сессии. Читается вместе с `AGENTS.md`; остальное — по
ссылкам и только при необходимости. Обновлять после каждого существенного этапа.
Секретов, паролей, ключей, медицинских и персональных данных здесь нет и быть не должно.

Актуально на этап 4 — VK Mini App (коммит, следующий за `a6f3790`).
Перед работой сверить с Git: `git log --oneline -5`.

## Продукт

- **Публичный сайт** — витрина ИИ-решений для частных медицинских клиник (Next.js).
  Демо: заявки в тестовом режиме, консультант на правилах, индексация выключена.
- **VK-бот «ИИ-администратор»** вымышленной клиники «Демо-Мед»: разговор (GPT или
  правила), подбор специалиста, запись и отмена по тестовому расписанию, передача
  администратору, проверка тревожных признаков. Канал — сообщения сообщества ВКонтакте
  (Bots Long Poll). Отвечает только тестовым аккаунтам.
- **Админ-панель клиники** `/admin`: записи, врачи, расписание, настройки, сотрудники и
  роли, «Мои приёмы» врача, журнал доступа к медицинским сведениям.
- **VK Mini App** `/miniapp`: врачи, свободное время, запись, отмена и перенос, услуги,
  о клинике — внутри ВКонтакте, по подписанным параметрам запуска, только тестовым
  аккаунтам. Та же база и расписание, что у бота и панели.
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
| Согласие пациента для бота  | `src/bot/consent.ts`                                                                                                                                       |
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
- **Версия схемы в коде: v6** (Mini App миграций не добавил; источник записи
  `miniapp` — значение существующего столбца). На VPS сейчас **v5** (коммит `a27d677`);
  после следующего обновления база перейдёт на v6.
- v1–v3 — записи, сессии, счётчики; v4 — справочники клиники, статусы записей; v5 —
  админ-панель; v6 — роли, приглашения, согласия, журнал доступа.

## Роли (кратко)

`owner` — сотрудники, настройки, все организационные разделы; `admin` — записи, врачи,
расписание; `doctor` — только свои приёмы. Медицинские сведения не открывает ни одна
роль сама по себе: врач видит краткое описание жалобы только своей записи и только по
согласию пациента. Подробно — [medical-privacy.md](medical-privacy.md).

## Состояние

- На VPS: `a27d677` (бот + админ-панель, схема v5), развёрнут и проверен Claude Desktop.
- Только в GitHub: `c199a0c` (роли, согласия, шифрование, схема v6) и этап 4 (VK Mini
  App) — протестированы в облаке, на VPS **не развёрнуты**; Mini App не открывался
  внутри настоящего ВКонтакте и не опубликован.
- Следующее: (1) владелец создаёт приложение VK Mini Apps и решает об обновлении VPS
  (`vk-mini-app-deploy.md`, включает этап 2), затем живая проверка на телефоне;
  (2) этап — согласие пациента на передачу конкретного фрагмента переписки
  администратору (не защищает от доступа через сам ВКонтакте).
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
перезапуск бота и панели → проверка. Пошагово: этап 2 (ключ `MEDICAL_DATA_KEY`, роли,
откат) — [privacy-update-vps.md](privacy-update-vps.md); Mini App (переменные, nginx,
настройка ВКонтакте, откат) — [vk-mini-app-deploy.md](vk-mini-app-deploy.md).

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
| Развёртывание панели, nginx, память VPS | [admin-panel-deploy.md](admin-panel-deploy.md)                   |
| Обновление и проверка разговорного бота | [conversational-bot-deploy.md](conversational-bot-deploy.md)     |
| Запуск бота, настройка сообщества       | [vk-bot-run.md](vk-bot-run.md), [vk-bot-plan.md](vk-bot-plan.md) |
| Этапы (длинный, искать поиском)         | [roadmap.md](roadmap.md)                                         |
| Готовность к production сайта           | [production-readiness.md](production-readiness.md)               |
