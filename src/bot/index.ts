/**
 * VK-бот ИИ-администратора — бизнес-логика без привязки к каналу и LLM.
 * Подробности и этапы — docs/vk-bot-plan.md.
 */
import { createBot, type AdminNotifier } from "@/bot/bot";
import type { ClinicSource } from "@/bot/clinic/types";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import { OpenAiClient } from "@/bot/llm/openai-client";
import { OpenAiConversationModel } from "@/bot/llm/openai-conversation";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { createConsentPort, createRequestPort } from "@/bot/consent";
import type { MedicalCipher } from "@/bot/storage/medical-crypto";
import { SqliteStore } from "@/bot/storage/sqlite";

export { createBot, type Bot } from "@/bot/bot";
export type { BotEvent, Reply, Button, Action } from "@/bot/dialog/types";

/** Собирает бота вымышленной клиники с хранилищем SQLite по указанному пути. */
export function createDemoBot({
  dbPath,
  clinic,
  now = () => new Date(),
  openai,
  notifier,
  handoffHours,
  historyHours,
  messagesPerMinute,
  cipher,
  medicalQuestions,
  miniApp,
  log,
}: {
  dbPath: string;
  /** По умолчанию — справочники клиники из той же базы (их меняет админ-панель). */
  clinic?: ClinicSource;
  now?: () => Date;
  /** Без ключа — только правила: бот работает по кнопкам и ключевым словам. */
  openai?: {
    apiKey: string;
    model: string;
    dailyLimit?: number;
    /** Одновременных запросов к OpenAI (OPENAI_CONCURRENCY). */
    concurrency?: number;
    /** Только для локальных тестов: адрес и fetch заглушки вместо OpenAI. */
    baseUrl?: string;
    fetch?: typeof fetch;
  };
  notifier?: AdminNotifier;
  handoffHours?: number;
  /** Срок хранения разговора без активности, часов. */
  historyHours?: number;
  messagesPerMinute?: number;
  /**
   * MEDICAL_DATA_KEY: шифрует разговоры в базе и включает необязательную
   * передачу описания жалобы врачу записи. Без ключа передачи нет.
   */
  cipher?: MedicalCipher;
  /** false — бот не задаёт вопросов о симптомах (BOT_MEDICAL_QUESTIONS). */
  medicalQuestions?: boolean;
  /** Настроен VK Mini App клиники (кнопка «Открыть приложение» в меню). */
  miniApp?: boolean;
  log?: (message: string) => void;
}) {
  const store = new SqliteStore(dbPath, { cipher });
  const source: ClinicSource = clinic ?? (() => store.clinic.load());
  const schedule = new ClinicSchedule(source, store, now);
  const rules = new RuleInterpreter(source);
  // GPT ведёт разговор; правила — запасной режим и проверки безопасности.
  const model = openai
    ? new OpenAiConversationModel(
        source,
        new OpenAiClient({
          apiKey: openai.apiKey,
          model: openai.model,
          dailyLimit: openai.dailyLimit,
          maxConcurrent: openai.concurrency,
          baseUrl: openai.baseUrl,
          fetch: openai.fetch,
          now,
          onError: log,
        }),
        log,
      )
    : undefined;
  const bot = createBot({
    clinic: source,
    schedule,
    sessions: store,
    interpreter: rules,
    model,
    notifier,
    handoffHours,
    historyHours,
    messagesPerMinute,
    consents: createConsentPort(store.consents, schedule, now),
    requests: createRequestPort(store.requests, now),
    appAvailable: miniApp ?? false,
    medicalQuestions,
    stats: store,
    now,
    onError: log,
  });
  return { bot, schedule, store };
}
