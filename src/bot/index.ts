/**
 * VK-бот ИИ-администратора — бизнес-логика без привязки к каналу и LLM.
 * Подробности и этапы — docs/vk-bot-plan.md.
 */
import { createBot, type AdminNotifier } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import type { Clinic } from "@/bot/clinic/types";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import { OpenAiClient } from "@/bot/llm/openai-client";
import { OpenAiConversationModel } from "@/bot/llm/openai-conversation";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";

export { createBot, type Bot } from "@/bot/bot";
export type { BotEvent, Reply, Button, Action } from "@/bot/dialog/types";

/** Собирает бота вымышленной клиники с хранилищем SQLite по указанному пути. */
export function createDemoBot({
  dbPath,
  clinic = fictionalClinic,
  now = () => new Date(),
  openai,
  notifier,
  handoffHours,
  historyHours,
  log,
}: {
  dbPath: string;
  clinic?: Clinic;
  now?: () => Date;
  /** Без ключа — только правила: бот работает по кнопкам и ключевым словам. */
  openai?: { apiKey: string; model: string; dailyLimit?: number };
  notifier?: AdminNotifier;
  handoffHours?: number;
  /** Срок хранения разговора без активности, часов. */
  historyHours?: number;
  log?: (message: string) => void;
}) {
  const store = new SqliteStore(dbPath);
  const schedule = new ClinicSchedule(clinic, store, now);
  const rules = new RuleInterpreter(clinic);
  // GPT ведёт разговор; правила — запасной режим и проверки безопасности.
  const model = openai
    ? new OpenAiConversationModel(
        clinic,
        new OpenAiClient({
          apiKey: openai.apiKey,
          model: openai.model,
          dailyLimit: openai.dailyLimit,
          now,
          onError: log,
        }),
        log,
      )
    : undefined;
  const bot = createBot({
    clinic,
    schedule,
    sessions: store,
    interpreter: rules,
    model,
    notifier,
    handoffHours,
    historyHours,
    now,
    onError: log,
  });
  return { bot, schedule, store };
}
