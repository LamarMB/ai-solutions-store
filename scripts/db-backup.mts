/**
 * Резервная копия базы бота и панели без остановки процессов:
 * SQLite `VACUUM INTO` создаёт целостную копию даже во время работы (WAL).
 *
 *   npm run db:backup                    → ../bot-backups/bot-ГГГГММДД-ЧЧММСС.sqlite
 *   npm run db:backup -- --dir=/путь     другой каталог
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadLocalEnv } from "@/bot/env";

loadLocalEnv();
const source = process.env.BOT_DB_PATH || ".data/bot.sqlite";
const dir = resolve(
  process.argv.find((a) => a.startsWith("--dir="))?.slice(6) ??
    "../bot-backups",
);
mkdirSync(dir, { recursive: true });
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace("T", "-")
  .slice(0, 15);
const target = join(dir, `bot-${stamp}.sqlite`);

const db = new DatabaseSync(source, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
db.prepare("VACUUM INTO ?").run(target);
const version = (
  db.prepare("PRAGMA user_version").get() as { user_version: number }
).user_version;
db.close();
console.log(`Копия создана: ${target} (схема v${version})`);
