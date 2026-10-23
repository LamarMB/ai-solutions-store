/**
 * Счётчики бота за последние дни: отклонённые запросы и обращения к модели.
 * Только количества — без текста сообщений и VK ID.
 *
 *   npm run bot:stats              за 7 дней
 *   npm run bot:stats -- --days=30
 */
import { loadLocalEnv } from "@/bot/env";
import { SqliteStore } from "@/bot/storage/sqlite";
import { STAT_KEYS } from "@/bot/conversation/guard";
import { addDays, localDateTime } from "@/bot/schedule/time";

loadLocalEnv();
const days = Number(
  process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 7,
);
const store = new SqliteStore(process.env.BOT_DB_PATH || ".data/bot.sqlite");
const today = localDateTime(new Date(), "Europe/Moscow").date;
const rows = store.readStats(addDays(today, -(Math.max(1, days) - 1)));
store.close();

const totals = new Map<string, number>();
for (const row of rows)
  totals.set(row.key, (totals.get(row.key) ?? 0) + row.count);

console.log(`Счётчики бота за ${days} дн. (без текста сообщений):`);
for (const key of STAT_KEYS)
  console.log(`  ${key.padEnd(22)} ${totals.get(key) ?? 0}`);
const requests = totals.get("model_requests") ?? 0;
const saved = totals.get("model_requests_saved") ?? 0;
if (requests + saved > 0)
  console.log(
    `Без обращения к модели обработано ${Math.round((saved / (requests + saved)) * 100)}% сообщений, которые иначе ушли бы в OpenAI.`,
  );
