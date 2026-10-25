// Реальные реплики демо-бота (режим правил, без ИИ) для карты продукта.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoBot, type Button, type Reply } from "@/bot";
import { MedicalCipher } from "@/bot/storage/medical-crypto";

const NOW = new Date(process.env.MAP_NOW ?? "2026-10-26T07:00:00.000Z");
type Step = { text: string } | { button: string };
const scenarios: Record<string, Step[]> = {
  greeting: [{ text: "Здравствуйте" }],
  routing: [{ text: "Болит колено" }, { text: "Нет" }, { text: "Неделю" }, { text: "Нет" }],
  emergency: [{ text: "Упал, сильная боль в груди и трудно дышать" }],
  info: [{ text: "Сколько стоит приём ортопеда?" }],
  scope: [{ text: "Напиши стихотворение про осень" }],
  handoff: [{ text: "Здравствуйте" }, { button: "Администратор" }, { text: "Хочу перенести запись на пятницу после 16:00" }, { button: "Разрешаю передачу" }],
  booking: [{ text: "Хочу записаться к терапевту" }],
};
const out: Record<string, unknown> = {};
for (const [name, steps] of Object.entries(scenarios)) {
  const dir = mkdtempSync(join(tmpdir(), "map-"));
  const { bot, store } = createDemoBot({
    dbPath: join(dir, "bot.sqlite"),
    now: () => NOW,
    cipher: MedicalCipher.fromBase64(MedicalCipher.generateKey()),
    miniApp: true,
  });
  const log: unknown[] = [];
  let buttons: Button[] = [];
  const push = (rs: Reply[]) => {
    for (const r of rs) {
      buttons = r.buttons.flat();
      log.push({ from: "bot", text: r.text, ...(buttons.length ? { buttons: buttons.map((b) => b.label) } : {}) });
    }
  };
  for (const step of steps) {
    if ("text" in step) {
      log.push({ from: "patient", text: step.text });
      push(await bot.handle(1, { type: "text", text: step.text }));
    } else {
      const b = buttons.find((x) => x.label === step.button);
      log.push({ from: "patient", text: step.button, button: true, found: !!b });
      if (b) push(await bot.handle(1, { type: "action", payload: b.action }));
    }
  }
  out[name] = log;
  store.close();
}
console.log(JSON.stringify(out, null, 1));
