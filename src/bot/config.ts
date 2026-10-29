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
const BotEnvSchema = z
  .object({
    VK_GROUP_ID: positiveId,
    VK_GROUP_TOKEN: z
      .string({ error: "ключ доступа сообщества не задан" })
      .trim()
      .min(20, "ключ доступа сообщества не задан или слишком короткий"),
    /**
     * demo — демонстрационная клиника: пометки «демо» в ответах, только тестовые
     * аккаунты. live — клиника-клиент: ответы без пометок, доступ всем пациентам
     * (или только VK_ALLOWED_USER_IDS, если список задан, — для проверки перед запуском).
     */
    BOT_MODE: z
      .enum(["demo", "live"], { error: "demo или live" })
      .default("demo"),
    VK_ALLOWED_USER_IDS: idList,
    VK_ADMIN_USER_ID: optional(positiveId),
    /** VK Mini App клиники: в меню бота появляется кнопка «Записаться онлайн». */
    VK_MINIAPP_ID: optional(positiveId),
    VK_API_VERSION: z.string().default("5.199"),
    OPENAI_API_KEY: optional(
      z
        .string()
        .trim()
        .min(
          20,
          "ключ слишком короткий — проверьте, что он скопирован целиком",
        ),
    ),
    OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
    OPENAI_DAILY_REQUEST_LIMIT: z.coerce.number().int().positive().default(500),
    /** Одновременных запросов к OpenAI; сверх — ожидание, затем ответ по правилам. */
    OPENAI_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    /** Пациентов, чьи сообщения обрабатываются одновременно (1 — строго по одному). */
    BOT_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
    /** Событий в очереди; при заполнении бот не забирает новые события из ВКонтакте. */
    BOT_QUEUE_LIMIT: z.coerce.number().int().min(10).max(10_000).default(500),
    /** Запросов к VK API в секунду (лимит ключа сообщества — 20). */
    VK_API_RPS: z.coerce.number().int().min(1).max(20).default(15),
    BOT_DB_PATH: z.string().default(".data/bot.sqlite"),
    BOT_HANDOFF_HOURS: z.coerce.number().positive().max(72).default(12),
    BOT_HISTORY_HOURS: z.coerce.number().positive().max(168).default(24),
    BOT_MESSAGES_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(3)
      .max(120)
      .default(12),
    /** Уточняющие вопросы о симптомах (травма, длительность, тревожные признаки). */
    BOT_MEDICAL_QUESTIONS: z
      .enum(["true", "false"], { error: "true или false" })
      .default("true"),
    MEDICAL_DATA_KEY: optional(
      z.string().refine(validKey, "нужен ключ 32 байта в base64"),
    ),
  })
  .refine((e) => e.BOT_MODE === "live" || e.VK_ALLOWED_USER_IDS.length > 0, {
    path: ["VK_ALLOWED_USER_IDS"],
    message: "нужен хотя бы один тестовый VK ID (BOT_MODE=demo)",
  })
  // Mini App пускает только тестовые аккаунты (MINIAPP_ALLOWED_USER_IDS):
  // пациенты получили бы кнопку «Открыть приложение», которая им не откроется.
  .refine(
    (e) =>
      !(
        e.BOT_MODE === "live" &&
        e.VK_ALLOWED_USER_IDS.length === 0 &&
        e.VK_MINIAPP_ID
      ),
    {
      path: ["VK_MINIAPP_ID"],
      message:
        "при открытом доступе (BOT_MODE=live) Mini App пока не поддерживается — оставьте пустым",
    },
  );

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

/** Кому отвечает бот: всем пациентам или только перечисленным VK ID. */
export type BotAccess = ReadonlySet<number> | "all";

export type BotConfig = {
  /** Демонстрационная клиника (пометки «демо» в ответах) или клиника-клиент. */
  mode: "demo" | "live";
  vk: {
    groupId: number;
    token: string;
    allowedUserIds: BotAccess;
    adminUserId?: number;
    apiVersion: string;
    /** ID VK Mini App клиники для кнопки open_app. */
    miniAppId?: number;
  };
  openai?: {
    apiKey: string;
    model: string;
    dailyLimit: number;
    /** Одновременных запросов к OpenAI. */
    concurrency: number;
  };
  /** Параллельная обработка событий ВКонтакте. */
  queue: { concurrency: number; limit: number; vkPerSecond: number };
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
      mode: e.BOT_MODE,
      vk: {
        groupId: e.VK_GROUP_ID,
        token: e.VK_GROUP_TOKEN,
        // Пустой список допустим только в режиме live (проверено схемой).
        allowedUserIds:
          e.VK_ALLOWED_USER_IDS.length > 0
            ? new Set(e.VK_ALLOWED_USER_IDS)
            : "all",
        adminUserId: e.VK_ADMIN_USER_ID as number | undefined,
        apiVersion: e.VK_API_VERSION,
        miniAppId: e.VK_MINIAPP_ID as number | undefined,
      },
      openai: e.OPENAI_API_KEY
        ? {
            apiKey: e.OPENAI_API_KEY as string,
            model: e.OPENAI_MODEL,
            dailyLimit: e.OPENAI_DAILY_REQUEST_LIMIT,
            concurrency: e.OPENAI_CONCURRENCY,
          }
        : undefined,
      queue: {
        concurrency: e.BOT_CONCURRENCY,
        limit: e.BOT_QUEUE_LIMIT,
        vkPerSecond: e.VK_API_RPS,
      },
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

/** Режим и доступ для журнала запуска — без самих VK ID. */
export function describeAccess(config: BotConfig): string {
  const access =
    config.vk.allowedUserIds === "all"
      ? "все пациенты"
      : `только тестовые аккаунты (${config.vk.allowedUserIds.size})`;
  return `режим: ${config.mode === "live" ? "клиника-клиент (live)" : "демо"}, доступ: ${access}`;
}

/** Журнал в консоль с временем. Только служебные сообщения, без текста пациентов. */
export function createLogger(prefix = "bot") {
  return (message: string) =>
    console.log(`${new Date().toISOString()} [${prefix}] ${message}`);
}
