// Скриншоты демо-стенда (вымышленные данные). Шаги — в steps.json рядом, если есть.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";

const OUT = process.env.GITHUB_WORKSPACE + "/out/shots";
const B = "http://127.0.0.1:3100";
const sign = (p) => {
  const q = Object.keys(p).filter((k) => k.startsWith("vk_")).sort().map((k) => `${k}=${encodeURIComponent(p[k])}`).join("&");
  return createHmac("sha256", process.env.VK_MINIAPP_SECRET).update(q).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const p = { vk_user_id: "900100", vk_app_id: process.env.VK_MINIAPP_ID, vk_ts: String(Math.floor(Date.now() / 1000)), vk_platform: "mobile_web", vk_language: "ru" };
const MINI = `${B}/miniapp?${new URLSearchParams({ ...p, sign: sign(p) })}`;
const browser = await chromium.launch();
const report = {};
const texts = async (page) => (await page.locator("button, a, h1, h2, h3").allInnerTexts()).map((t) => t.trim()).filter(Boolean).slice(0, 80);
const shot = async (page, name, full = false) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); report[name] = await texts(page); };
const run = async (name, fn) => { try { await fn(); } catch (e) { report[name + ":error"] = String(e).slice(0, 400); } };

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU", reducedMotion: "no-preference" });
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU", reducedMotion: "no-preference" });

const stepsMod = await import(process.env.STEPS || "./steps.mjs").catch(() => null);
const ctx = { B, MINI, phone, desk, shot, run, report, password: process.env.DEMO_PASSWORD };
if (stepsMod) await stepsMod.default(ctx);
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
