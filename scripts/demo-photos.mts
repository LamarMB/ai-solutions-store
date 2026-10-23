/**
 * Демо-портреты (созданы ИИ) для вымышленных врачей «Демо-Мед»:
 *   npm run doctors:demo-photos            привязать тем, у кого фото ещё нет
 *   npm run doctors:demo-photos -- --force заменить и загруженные в панели
 * Только врачи с id и именем из начальных данных. Реальных врачей не трогает.
 */
import { loadLocalEnv } from "@/bot/env";
import { bindDemoPhotos } from "@/bot/demo-photos";
import { SqliteStore } from "@/bot/storage/sqlite";

loadLocalEnv();
const store = new SqliteStore(process.env.BOT_DB_PATH || ".data/bot.sqlite");
const LABELS = {
  set: "фото привязано",
  kept: "уже есть фото — не меняю (--force, чтобы заменить)",
  skipped_name: "имя врача изменено — не демо-врач, пропускаю",
  missing_doctor: "нет такого врача — пропускаю",
  invalid: "файл не прошёл проверку",
} as const;
try {
  for (const r of bindDemoPhotos(store, new Date().toISOString(), {
    force: process.argv.includes("--force"),
  }))
    console.log(`${r.doctorId}: ${LABELS[r.result]}`);
} finally {
  store.close();
}
