# AGENTS.md — правила проекта

Этот файл — главный источник правил для людей и ИИ-агентов, работающих с репозиторием.
Статус этапов — в [docs/roadmap.md](docs/roadmap.md), запуск — в [README.md](README.md).

## Цель

Сайт компании по внедрению ИИ и автоматизации для бизнеса разных отраслей в формате
интернет-магазина цифровых решений: каталог, категории, отрасли, поиск, карточки решений
(стоимость, этапы внедрения, требования к данным и доступам заказчика, состав работ,
ограничения), ИИ-консультант по услугам, заявка на выбранное решение.
Позже: CRM, агенты поиска клиентов, автоматизация продаж, возможно онлайн-оплата.

## Согласованная архитектура (не пересматривать без причины)

- Одно приложение: Next.js 16.x (App Router) + TypeScript + Tailwind CSS, пакетный менеджер npm.
- Node.js 24 LTS (`.nvmrc`, `engines`). Основная среда разработки — Windows.
- Каталог — файлы в репозитории со строгой схемой (Zod). Категории и отрасли —
  независимые классификации.
- Цена хранится структурно: тип (фикс / «от» / по запросу), сумма в минимальных
  единицах валюты, валюта.
- Заявка — черновик заказа из позиций «решение + пакет», чтобы позже добавить корзину
  и оплату без переписывания.
- ИИ-консультант — через интерфейс сменного провайдера (`ChatProvider`) с mock-реализацией.
  Конкретный LLM-провайдер не выбирается без проверки доступности и стоимости.
- Импорты внутри `src/` — через алиас `@/*` (`tsconfig.json` → `./src/*`).

## Жёсткие правила

- Работаем небольшими этапами. После каждого этапа — проверка и подтверждение владельца.
- Демонстрационные данные явно помечаются (`isDemo` + видимая плашка «Демо»).
- Не выдумывать реальные кейсы, отзывы, гарантии и результаты от имени компании.
- Не подключать реальные платежи, не собирать реальные персональные данные,
  не разворачивать в production (только по отдельному решению).
- Отделять проверенные факты от предположений; не придумывать результаты проверок.
- Секреты не коммитятся. Пример переменных — `.env.example`, реальные — `.env.local`.
- Не добавлять зависимости без необходимости.

## Каталог

- Схема — `src/catalog/schema.ts` (Zod, строгие объекты: неизвестные поля запрещены).
  Типы выводятся из схемы, отдельно их не описывать.
- Данные — TypeScript-модули в `src/content/`: `categories.ts`, `industries.ts`,
  `solutions/<id>.ts` (одно решение — один файл, плюс регистрация в `solutions/index.ts`).
- Каталог проверяется целиком при импорте `@/catalog` (`parseCatalog`): уникальность id,
  ссылки на категории и отрасли. Ошибка в данных ломает тесты.
- Категории и отрасли — независимые справочники. Пустой `industryIds` = любая отрасль.
- Цена: `{ kind: "fixed" | "from", amount, currency: "RUB" }` или `{ kind: "on_request" }`.
  `amount` — целое число в копейках (150 000 ₽ = `15000000`).
- Вид цены нельзя терять: «от» никогда не превращается в фиксированную цену
  (`getStartingPrice`, `formatPrice` в `src/catalog/price.ts`).
- Позиция будущей заявки — пара `(solutionId, packageId)`; id пакетов уникальны внутри решения.
- Каждое демонстрационное решение — `isDemo: true` (поле обязательное). Справочники
  категорий и отраслей `isDemo` не имеют.

## Процесс и Git

- Приватный GitHub-репозиторий `ai-solutions-store`. Одна ветка на этап, PR в `main`.
- Merge выполняет владелец; после merge ставится тег `stage-N`.
- `package-lock.json` всегда в Git; установка в CI — `npm ci`.
- Push — в конце каждой сессии (после подтверждения владельца).

## Обязательные проверки перед PR

```
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
```

Те же шаги выполняет CI (`.github/workflows/ci.yml`) на ubuntu-latest и windows-latest.
Проверка в Linux/CI не заменяет ручную проверку на Windows-машине владельца.

## Справка по Next.js для агентов

Блок ниже генерирует и поддерживает сам Next.js (`next dev` восстанавливает его).
Не удалять.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
