import { z } from "zod";
import { MedicalCipher } from "@/bot/storage/medical-crypto";

const positiveId = z.coerce
  .number({ error: "нужно число" })
  .int({ error: "нужно целое число" })
  .positive({ error: "нужно положительное число" });

const idList = z
  .string()
  .default("")
  .transform((value, ctx) => {
    const ids = value
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number);
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      ctx.addIssue({
        code: "custom",
        message: "список числовых VK ID через запятую",
      });
    }
    return ids;
  });

const optional = (schema: z.ZodType) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

/** Переменные окружения бота. Секреты не выводятся ни в ошибках, ни в логах. */
const BotEnvSchema = z.object({
  VK_GROUP_ID: positiveId,
  VK_GROUP_TOKEN: z
    .string({ error: "ключ доступа сообщества не задан" })
    .trim()
    .min(20, "ключ доступа сообщества не задан или слишком короткий"),
  VK_ALLOWED_USER_IDS: idList.refine((ids) => ids.length > 0, {
    message: "нужен хотя бы один тестовый VK ID",
  }),
  VK_ADMIN_USER_ID: optional(positiveId),
  VK_API_VERSION: z.string().default("5.199"),
  OPENAI_API_KEY: optional(
    z
      .string()
      .trim()
      .min(20, "ключ слишком короткий — проверьте, что он скопирован целиком"),
  ),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
  OPENAI_DAILY_REQUEST_LIMIT: z.coerce.number().int().positive().default(500),
  BOT_DB_PATH: z.string().default(".data/bot.sqlite"),
  BOT_HANDOFF_HOURS: z.coerce.number().positive().max(72).default(12),
  BOT_HISTORY_HOURS: z.coerce.number().positive().max(168).default(24),
  BOT_MESSAGES_PER_MINUTE: z.coerce.number().int().min(3).max(120).default(12),
  /** Уточняющие вопросы о симптомах (травма, длительность, тревожные признаки). */
  BOT_MEDICAL_QUESTIONS: z
    .enum(["true", "false"], { error: "true или false" })
    .default("true"),
  MEDICAL_DATA_KEY: optional(
    z.string().refine(validKey, "нужен ключ 32 байта в base64"),
  ),
});

function validKey(value: string): boolean {
  try {
    MedicalCipher.fromBase64(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Шифр медицинских сведений из MEDICAL_DATA_KEY. Без ключа разговоры
 * хранятся без шифрования (как раньше), а передача сведений врачу выключена.
 */
export function medicalCipherFromEnv(
  env: Record<string, string | undefined> = process.env,
): MedicalCipher | undefined {
  const key = env.MEDICAL_DATA_KEY?.trim();
  return key ? MedicalCipher.fromBase64(key) : undefined;
}

export type BotConfig = {
  vk: {
    groupId: number;
    token: string;
    allowedUserIds: ReadonlySet<number>;
    adminUserId?: number;
    apiVersion: string;
  };
  openai?: { apiKey: string; model: string; dailyLimit: number };
  dbPath: string;
  handoffHours: number;
  /** Срок хранения разговора без активности, часов. */
  historyHours: number;
  /** Текстовых сообщений в минуту от одного собеседника. */
  messagesPerMinute: number;
  /** false — бот не задаёт вопросов о симптомах, только маршрутизирует и записывает. */
  medicalQuestions: boolean;
  /** Шифрование разговоров и согласий (MEDICAL_DATA_KEY). */
  cipher?: MedicalCipher;
};

export type ConfigResult =
  { ok: true; config: BotConfig } | { ok: false; errors: string[] };

/** Читает настройки; ошибки — по имени переменной, без значений. */
export function loadBotConfig(
  env: Record<string, string | undefined>,
): ConfigResult {
  const parsed = BotEnvSchema.safeParse(env);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${String(issue.path[0])}: ${issue.message}`,
      ),
    };
  }
  const e = parsed.data;
  return {
    ok: true,
    config: {
      vk: {
        groupId: e.VK_GROUP_ID,
        token: e.VK_GROUP_TOKEN,
        allowedUserIds: new Set(e.VK_ALLOWED_USER_IDS),
        adminUserId: e.VK_ADMIN_USER_ID as number | undefined,
        apiVersion: e.VK_API_VERSION,
      },
      openai: e.OPENAI_API_KEY
        ? {
            apiKey: e.OPENAI_API_KEY as string,
            model: e.OPENAI_MODEL,
            dailyLimit: e.OPENAI_DAILY_REQUEST_LIMIT,
          }
        : undefined,
      dbPath: e.BOT_DB_PATH,
      handoffHours: e.BOT_HANDOFF_HOURS,
      historyHours: e.BOT_HISTORY_HOURS,
      messagesPerMinute: e.BOT_MESSAGES_PER_MINUTE,
      medicalQuestions: e.BOT_MEDICAL_QUESTIONS === "true",
      cipher: e.MEDICAL_DATA_KEY
        ? MedicalCipher.fromBase64(e.MEDICAL_DATA_KEY as string)
        : undefined,
    },
  };
}

/** Журнал в консоль с временем. Только служебные сообщения, без текста пациентов. */
export function createLogger(prefix = "bot") {
  return (message: string) =>
    console.log(`${new Date().toISOString()} [${prefix}] ${message}`);
}
