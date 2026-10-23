import { existsSync } from "node:fs";

/** Загружает .env.local, если он есть. Уже заданные переменные окружения не меняются. */
export function loadLocalEnv(path = ".env.local"): boolean {
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}
