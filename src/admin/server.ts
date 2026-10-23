import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, homeFor, type Permission } from "@/admin/permissions";
import { AdminAuth, authConfigFromEnv, cookieName } from "@/admin/auth";
import type { AdminApiDeps } from "@/admin/api";
import { AdminService } from "@/admin/service";
import { medicalCipherFromEnv } from "@/bot/config";
import { SqliteStore } from "@/bot/storage/sqlite";
import { createClientKeyHasher } from "@/lib/client-key";

/**
 * Зависимости панели в процессе Next.js. База — та же, что у бота
 * (BOT_DB_PATH, по умолчанию .data/bot.sqlite): бот и панель работают
 * отдельными процессами с одним файлом SQLite в режиме WAL.
 */
let deps: AdminApiDeps | undefined;

export function adminDeps(): AdminApiDeps {
  if (!deps) {
    // Ключ нужен панели только для чтения сведений врачом по согласию пациента.
    const store = new SqliteStore(
      process.env.BOT_DB_PATH || ".data/bot.sqlite",
      { cipher: medicalCipherFromEnv() },
    );
    const hashClient = createClientKeyHasher();
    deps = {
      service: new AdminService(store),
      auth: new AdminAuth(store.admin),
      config: authConfigFromEnv(),
      clientKey: (request) => hashClient(request.headers),
      log: (message) => console.warn(`[admin] ${message}`),
    };
  }
  return deps;
}

/** Сессия сотрудника для серверных страниц панели (с ролью). */
export async function currentAdmin() {
  const { auth, config } = adminDeps();
  const token = (await cookies()).get(cookieName(config))?.value;
  return auth.verify(token);
}

/**
 * Страница панели только для роли с правом `permission`. Без сессии — вход,
 * без права — своя первая страница. Данные страницы всё равно проверяет API.
 */
export async function requirePage(permission: Permission) {
  const session = await currentAdmin();
  if (!session) redirect("/admin/login");
  if (!can(session.role, permission)) redirect(homeFor(session.role));
  return session;
}
