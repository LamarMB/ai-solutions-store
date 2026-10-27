/**
 * Подготовка ЛОКАЛЬНОЙ тестовой базы для нагрузочного теста (docs/load-test-report.md).
 * Только вымышленная клиника «Демо-Мед», вымышленные сотрудники и VK ID.
 *
 *   npx tsx scripts/load/prepare.mts --db=путь --users=600 --secret=тестовый-ключ --out=launch.json [--variant=0..19]
 *
 * Создаёт базу (миграции), сотрудника роли admin «load-admin» с паролем из
 * LOAD_ADMIN_PASSWORD и подписанные параметры запуска Mini App для VK ID
 * 9000001…; --variant меняет часы приёма врачей (модель разных клиник).
 */
import { writeFileSync } from "node:fs";
import { hashPassword } from "@/admin/password";
import { AdminService } from "@/admin/service";
import { SqliteStore } from "@/bot/storage/sqlite";
import { signLaunchParams } from "@/miniapp/launch-params";

const arg = (name: string, fallback?: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ??
  fallback;

const db = arg("db");
const out = arg("out");
const secret = arg("secret");
const users = Number(arg("users", "600"));
const variant = arg("variant");
const appId = arg("app", "51000001")!;
const password = process.env.LOAD_ADMIN_PASSWORD;
if (!db || !out || !secret || !password) {
  console.error(
    "Нужны --db, --out, --secret и LOAD_ADMIN_PASSWORD (только для локальной тестовой базы)",
  );
  process.exit(1);
}

export const FIRST_USER_ID = 9_000_001;

const store = new SqliteStore(db);
const now = new Date().toISOString();
const userId = store.admin.createUser(
  "load-admin",
  await hashPassword(password),
  now,
  "admin",
);

if (variant !== undefined) {
  // Разные клиники — разные часы приёма: детерминированно по номеру варианта.
  const v = Number(variant);
  const service = new AdminService(store);
  const doctors = store.clinic.load().doctors;
  doctors.forEach((doctor, i) => {
    const start = 8 + ((v + i) % 4); // 08:00…11:00
    const length = 4 + ((v * 3 + i) % 5); // 4…8 часов
    const days = [1, 2, 3, 4, 5, 6].filter((d) => (d + v + i) % 3 !== 0);
    const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
    service.setHours(
      doctor.id,
      {
        hours: days.map((weekday) => ({
          weekday,
          from: pad(start),
          to: pad(Math.min(start + length, 20)),
        })),
      },
      Number(userId),
    );
  });
}
store.close();

const ts = String(Math.floor(Date.now() / 1000));
const launch: string[] = [];
for (let i = 0; i < users; i++) {
  const params: Record<string, string> = {
    vk_app_id: appId,
    vk_is_app_user: "1",
    vk_language: "ru",
    vk_platform: "mobile_android",
    vk_ts: ts,
    vk_user_id: String(FIRST_USER_ID + i),
  };
  launch.push(
    new URLSearchParams({
      ...params,
      sign: signLaunchParams(params, secret),
    }).toString(),
  );
}
writeFileSync(
  out,
  JSON.stringify({ firstUserId: FIRST_USER_ID, users, appId, launch }),
);
console.log(`база ${db}: готово; параметров запуска: ${users}`);
