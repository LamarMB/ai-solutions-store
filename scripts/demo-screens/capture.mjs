/**
 * Снимки экранов демо-стенда для карты продукта (public/demo). Только временная
 * база с вымышленной клиникой — рабочую базу и VPS не использовать.
 * Порядок — docs/product-map.md. Playwright не входит в зависимости проекта:
 *   npm i --no-save playwright && npx playwright install chromium
 * Переменные: BASE (адрес next start), DEMO_PASSWORD, VK_MINIAPP_ID,
 * VK_MINIAPP_SECRET, SHOTS_DIR (по умолчанию .data/demo-screens).
 */
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const B = process.env.BASE ?? "http://127.0.0.1:3100";
const OUT = process.env.SHOTS_DIR ?? ".data/demo-screens";
mkdirSync(OUT, { recursive: true });

// Параметры запуска Mini App подписываются так же, как во ВКонтакте.
const sign = (params) => {
  const query = Object.keys(params)
    .filter((k) => k.startsWith("vk_"))
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
  return createHmac("sha256", process.env.VK_MINIAPP_SECRET)
    .update(query)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};
const params = {
  vk_user_id: "900100",
  vk_app_id: process.env.VK_MINIAPP_ID,
  vk_ts: String(Math.floor(Date.now() / 1000)),
  vk_platform: "mobile_web",
  vk_language: "ru",
};
const MINI = `${B}/miniapp?${new URLSearchParams({ ...params, sign: sign(params) })}`;

const browser = await chromium.launch();
const settle = (page) =>
  page.waitForLoadState("networkidle").then(() => page.waitForTimeout(1200));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "ru-RU",
});
let page = await phone.newPage();
await page.goto(MINI);
await settle(page);
await shot(page, "mini-home");
await page.getByRole("button", { name: "Врачи" }).last().click();
await settle(page);
await page.getByText("Анна Тестова").first().click();
await settle(page);
await shot(page, "mini-doctor");
await page
  .getByRole("button", { name: /Записаться/ })
  .first()
  .click();
await settle(page);
await page
  .getByRole("button", { name: /^\s*\d{1,2}:\d{2}\s*$/ })
  .first()
  .click();
await settle(page);
await shot(page, "mini-slots");
page = await phone.newPage();
await page.goto(MINI);
await settle(page);
await page.getByRole("button", { name: "Записи" }).last().click();
await settle(page);
await shot(page, "mini-my");

async function login(user) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ru-RU",
  });
  const p = await ctx.newPage();
  await p.goto(`${B}/admin/login`);
  await p.locator("input").nth(0).fill(user);
  await p.locator('input[type="password"]').fill(process.env.DEMO_PASSWORD);
  await p.keyboard.press("Enter");
  await p.waitForURL(/\/admin(?!\/login)/);
  return p;
}
page = await login("demo-admin");
for (const r of ["", "bookings", "schedule", "doctors"]) {
  await page.goto(`${B}/admin/${r}`);
  await settle(page);
  await shot(page, `admin-${r || "home"}`);
}
await page.goto(`${B}/admin/requests`);
await settle(page);
await page.getByRole("button", { name: "Открыть текст" }).first().click();
await settle(page);
await shot(page, "admin-requests");
page = await login("demo-owner");
await page.goto(`${B}/admin/staff`);
await settle(page);
await shot(page, "admin-staff");
page = await login("demo-doctor");
await page.goto(`${B}/admin/my`);
await settle(page);
await shot(page, "admin-my");
await browser.close();
console.log(`Снимки: ${OUT}`);
