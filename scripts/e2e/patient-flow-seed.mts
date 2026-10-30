/**
 * Временная база для сквозного сценария `npm run e2e:patient-flow`: клиника
 * «Демо-Мед» из начальной миграции, владелец панели и запись другого
 * вымышленного пациента (её удаление пациента 900100 затрагивать не должно).
 * Запускается только из scripts/e2e/patient-flow.mjs и только с новым файлом
 * базы во временном каталоге.
 */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { hashPassword } from "@/admin/password";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import { SqliteStore } from "@/bot/storage/sqlite";

const path = resolve(process.env.BOT_DB_PATH ?? "");
const root = resolve(process.env.E2E_TMP_ROOT ?? "");
if (
  !process.env.E2E_TMP_ROOT ||
  !root.startsWith(resolve(tmpdir()) + sep) ||
  !path.startsWith(root + sep) ||
  existsSync(path)
)
  throw new Error(
    "Нужен новый файл базы во временном каталоге сценария: рабочие базы не заполняем.",
  );

const store = new SqliteStore(path, {
  cipher: MedicalCipher.fromBase64(process.env.MEDICAL_DATA_KEY!),
});
const at = new Date().toISOString();
store.admin.createUser(
  process.env.E2E_OWNER_LOGIN!,
  await hashPassword(process.env.E2E_OWNER_PASSWORD!),
  at,
  "owner",
);
// Последний слот последнего доступного дня — подальше от слота, который
// займёт сценарий (первый свободный).
const schedule = new ClinicSchedule(() => store.clinic.load(), store);
const day = schedule.listAvailableDays("testova").at(-1);
const slot = day && schedule.listFreeSlots("testova", day).at(-1);
if (!day || !slot) throw new Error("У врача testova нет свободных слотов.");
const other = schedule.book(
  Number(process.env.E2E_OTHER_VK_ID),
  "testova",
  day,
  slot,
  {
    admin: true,
    source: "admin",
  },
);
if (other.status !== "ok")
  throw new Error(`Запись другого пациента не создана: ${other.status}`);
store.close();
console.log(JSON.stringify({ otherBookingId: other.booking.id }));
