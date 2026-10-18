import { cookies } from "next/headers";
import { AdminAuth, authConfigFromEnv, cookieName } from "@/admin/auth";
import type { AdminApiDeps } from "@/admin/api";
import { AdminService } from "@/admin/service";
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
    const store = new SqliteStore(
      process.env.BOT_DB_PATH || ".data/bot.sqlite",
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

/** Сессия администратора для серверных страниц панели. */
export async function currentAdmin() {
  const { auth, config } = adminDeps();
  const token = (await cookies()).get(cookieName(config))?.value;
  return auth.verify(token);
}
