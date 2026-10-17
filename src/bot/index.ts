/**
 * VK-бот ИИ-администратора — бизнес-логика без привязки к каналу и LLM.
 * Подробности и этапы — docs/vk-bot-plan.md.
 */
import { createBot } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import type { Clinic } from "@/bot/clinic/types";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";

export { createBot, type Bot } from "@/bot/bot";
export type { BotEvent, Reply, Button, Action } from "@/bot/dialog/types";

/** Собирает бота вымышленной клиники с хранилищем SQLite по указанному пути. */
export function createDemoBot({
  dbPath,
  clinic = fictionalClinic,
  now = () => new Date(),
}: {
  dbPath: string;
  clinic?: Clinic;
  now?: () => Date;
}) {
  const store = new SqliteStore(dbPath);
  const schedule = new ClinicSchedule(clinic, store, now);
  const bot = createBot({
    clinic,
    schedule,
    sessions: store,
    interpreter: new RuleInterpreter(),
    now,
  });
  return { bot, schedule, store };
}
