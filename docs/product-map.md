# Карта продукта «Демо-Мед»

Интерактивная презентация ИИ-администратора для владельцев клиник: что покупает клиника,
как с системой работает пациент, что получают администратор и врач, как проходит внедрение.

## Где на сайте

| Место                                    | Компонент     | Содержание                                                     |
| ---------------------------------------- | ------------- | -------------------------------------------------------------- |
| Главная, «Путь пациента» (`#path`)       | `PatientPath` | Пять шагов (`overviewSteps`), закреплённый экран демо шага     |
| `/catalog/clinic-ai-administrator`       | `ProductMap`  | Десять узлов на трёх дорожках, подробности, экраны, «В планах» |
| Та же страница, «Как проходит внедрение» | `SetupFlow`   | Девять этапов: что делаем, что нужно от клиники, результат     |

Якоря: `#product-map`, `#product-setup`; узлы и этапы выбираются ссылками `#map-a5`,
`#setup-b4` (без дублирующихся id в разметке — схему и мобильный список рендерит один
компонент).

## Данные и правила

- `src/content/product-map.ts` — узлы, этапы, шаги главной, экраны, `plannedFeatures`,
  пояснение о внешнем ИИ (`AI_NOTE`). Статусы: «Работает в демо», «Настраивается под
  клинику», «В планах».
- Будущее — только в `plannedFeatures` и только в подробной карте. Тест
  `src/content/product-map.test.ts` проверяет связи, наличие экранов, тексты (без цифр,
  кроме 103 и 112, без гарантий и обещаний), формулировку записи и пояснение о внешнем ИИ.
- Переписка — `src/content/product-map-chats.ts`: реплики настоящего демо-бота в режиме
  правил на время `CHAT_NOW`. Тест прогоняет каждую переписку через `createDemoBot` и
  требует точного совпадения. Если бот изменился — снимите реплики заново и обновите файл.
- Тема — `.theme-product-map` в `globals.css` (переопределяет токены только внутри
  карты). Анимации: появление узлов, рисование линий, бегущий пунктир активной связи,
  пульс активного узла; при `prefers-reduced-motion`
  отключаются глобальным правилом.
- Зависимостей нет: SVG, CSS и React. GSAP, Lenis и React Bits не используются.

## Экраны демо

`public/demo/*.webp` — снимки демо-стенда на **временной** базе с вымышленной клиникой
(никогда не рабочая база и не VPS). На снимках с ИИ-портретами врачей — `aiPhotos: true`
и подпись «фото врачей созданы ИИ».

Как снять заново (Linux или WSL, Node 24):

```bash
npm ci && npm run build
export BOT_DB_PATH=/tmp/demo/bot.sqlite DEMO_PASSWORD=demo-$(openssl rand -hex 8)
export MEDICAL_DATA_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export VK_MINIAPP_ID=51000001 VK_MINIAPP_SECRET=demo-secret-0123456789
export MINIAPP_ALLOWED_USER_IDS=900100 VK_ALLOWED_USER_IDS=900100 ADMIN_COOKIE_SECURE=false
mkdir -p /tmp/demo && npx tsx scripts/demo-screens/seed.mts
npx next start -H 127.0.0.1 -p 3100 &
npm i --no-save playwright && npx playwright install chromium
node scripts/demo-screens/capture.mjs   # PNG в .data/demo-screens
```

Затем PNG уменьшаются и сохраняются в WebP: телефон — ширина 540, панель — 1200 × 750.
Размеры в `product-map.ts` должны совпадать с файлами.

## Как посмотреть локально

```bash
npm run dev
```

- http://localhost:3000/ — блок «Как это работает» (кнопка в первом экране ведёт к нему);
- http://localhost:3000/catalog/clinic-ai-administrator#product-map — подробная карта;
- …#product-setup — этапы внедрения.
