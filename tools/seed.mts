/**
 * Временная база для снимков карты продукта (docs/product-map.md): клиника
 * «Демо-Мед» из начальной миграции, сотрудники трёх ролей, демо-портреты
 * (созданы ИИ), вымышленные записи и одно обращение. Только новый файл базы:
 *   BOT_DB_PATH=/tmp/demo/bot.sqlite MEDICAL_DATA_KEY=… DEMO_PASSWORD=… \
 *     npx tsx scripts/demo-screens/seed.mts
 */
import { existsSync } from "node:fs";
import { hashPassword } from "@/admin/password";
import { bindDemoPhotos } from "@/bot/demo-photos";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import { SqliteStore } from "@/bot/storage/sqlite";

if (existsSync(process.env.BOT_DB_PATH ?? ".data/bot.sqlite"))
  throw new Error("Нужен новый файл базы: рабочую базу не заполняем демо-данными.");
const store = new SqliteStore(process.env.BOT_DB_PATH!, {
  cipher: MedicalCipher.fromBase64(process.env.MEDICAL_DATA_KEY!),
});
const at = new Date().toISOString();
const hash = await hashPassword(process.env.DEMO_PASSWORD!);
store.admin.createUser("demo-owner", hash, at, "owner");
store.admin.createUser("demo-admin", hash, at, "admin");
store.admin.createUser("demo-doctor", hash, at, "doctor", "testova");
console.log(bindDemoPhotos(store, at).map((r) => `${r.doctorId}:${r.result}`).join(" "));
// Сегодня может быть выходной: двум врачам добавляются часы на сегодняшний день
// недели, чтобы на главной панели были записи «на сегодня» (только демо-стенд).
const weekday = new Date().getDay() || 7;
for (const id of ["primerov", "obraztsova"]) {
  const d = store.clinic.load().doctors.find((x) => x.id === id);
  if (d && !d.hours.some((h) => h.weekday === weekday))
    store.clinic.setHours(id, [...d.hours, { weekday, from: "08:00", to: "20:00" }]);
}
const schedule = new ClinicSchedule(() => store.clinic.load(), store);
const today = new Date().toISOString().slice(0, 10);
let t = 0;
for (const id of ["primerov", "obraztsova"]) {
  for (const time of schedule.listFreeSlots(id, today, { admin: true }).filter((x) => x >= "10:00").slice(0, 2)) {
    const r = schedule.book(900300 + t, id, today, time, { admin: true, source: (["vk", "miniapp", "admin"] as const)[t++ % 3] });
    if (r.status !== "ok") console.log("today", id, time, r.status);
  }
}
const sources = ["vk", "miniapp", "admin"] as const;
let peer = 900200;
let n = 0;
for (const d of schedule.clinic.doctors) {
  for (const day of schedule.listAvailableDays(d.id).slice(0, 2)) {
    for (const t of schedule.listFreeSlots(d.id, day, { admin: true }).filter((_, i) => i % 3 === 1).slice(0, 2)) {
      const r = schedule.book(peer++, d.id, day, t, { admin: true, source: sources[n++ % 3] });
      if (r.status !== "ok") console.log("book", d.id, day, t, r.status);
    }
  }
}
// Запись тестового пациента Mini App (VK ID 900100) — для «Моих записей».
const doc = schedule.clinic.doctors[0];
const day = schedule.listAvailableDays(doc.id)[1];
const slot = schedule.listFreeSlots(doc.id, day)[2];
console.log("mine", JSON.stringify(schedule.book(900100, doc.id, day, slot, { source: "miniapp" })));
store.requests.create(900201, "Хочу перенести запись на пятницу после 16:00", at);
store.setBotStatus("started_at", at, at);
store.setBotStatus("last_poll_at", at, at);
console.log("bookings", n, "users 3, request 1");
store.close();
