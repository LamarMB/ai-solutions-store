# AI Solutions Store

Сайт-каталог решений по внедрению ИИ и автоматизации для бизнеса.
**Статус: демо-версия, в разработке.** Правила проекта — [AGENTS.md](AGENTS.md),
этапы — [docs/roadmap.md](docs/roadmap.md).

Стек: Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Zod · Vitest · ESLint · Prettier · npm.

## Требования

- **Node.js 24 LTS** (версия указана в `.nvmrc`; npm идёт в комплекте).
- Git.

## Запуск на Windows

1. Установите Node.js 24 одним из способов:
   - установщик LTS с https://nodejs.org;
   - или менеджер версий [nvm-windows](https://github.com/coreybutler/nvm-windows):
     ```powershell
     nvm install 24
     nvm use 24
     ```

   Проверка: `node -v` должен показать `v24.x.x`.

2. Клонируйте репозиторий и установите зависимости строго по `package-lock.json`:

   ```powershell
   git clone https://github.com/LamarMB/ai-solutions-store.git
   cd ai-solutions-store
   npm ci
   ```

3. Запустите сервер разработки и откройте http://localhost:3000:

   ```powershell
   npm run dev
   ```

Команды одинаково работают в PowerShell, cmd и Git Bash. Окончания строк (LF)
закреплены в `.gitattributes`, менять глобальные настройки Git не требуется.

## Переменные окружения

На этапе 1 не требуются. Пример — `.env.example`; локальные значения кладите в
`.env.local` (он не попадает в Git).

## Скрипты

| Команда                | Что делает                                         |
| ---------------------- | -------------------------------------------------- |
| `npm run dev`          | сервер разработки на http://localhost:3000         |
| `npm run build`        | production-сборка                                  |
| `npm run start`        | запуск собранной версии (после `build`)            |
| `npm run lint`         | ESLint                                             |
| `npm run typecheck`    | генерация типов маршрутов Next.js + `tsc --noEmit` |
| `npm run test`         | тесты (Vitest)                                     |
| `npm run format`       | форматирование Prettier (изменяет файлы)           |
| `npm run format:check` | проверка форматирования без изменений              |

Перед PR должны проходить: `lint`, `typecheck`, `test`, `format:check`, `build`.
CI (GitHub Actions) выполняет их на Ubuntu и Windows.
