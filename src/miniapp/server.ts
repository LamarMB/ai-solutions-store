import type { MiniAppApiDeps } from "@/miniapp/api";
import { miniAppConfigFromEnv } from "@/miniapp/config";
import { MiniAppService } from "@/miniapp/service";
import { SqliteStore } from "@/bot/storage/sqlite";

/**
 * Зависимости Mini App в процессе Next.js. База — та же, что у бота и панели
 * (BOT_DB_PATH). Ключ шифрования не нужен: Mini App не читает разговоры и
 * медицинские сведения. Без настроек VK Mini App API отвечает 503.
 */
let deps: MiniAppApiDeps | null | undefined;

export function miniAppDeps(): MiniAppApiDeps | null {
  if (deps === undefined) {
    const result = miniAppConfigFromEnv();
    if (!result.ok) {
      console.warn(`[miniapp] не настроено: ${result.errors.join("; ")}`);
      deps = null;
    } else {
      const store = new SqliteStore(
        process.env.BOT_DB_PATH || ".data/bot.sqlite",
      );
      deps = {
        service: new MiniAppService(store),
        config: result.config,
        log: (message) => console.warn(`[miniapp] ${message}`),
      };
    }
  }
  return deps;
}

/** Фото врачей нужны и панели, поэтому — отдельно от настроек Mini App. */
let photos: SqliteStore | undefined;
export function photoStore() {
  photos ??= new SqliteStore(process.env.BOT_DB_PATH || ".data/bot.sqlite");
  return photos.photos;
}
