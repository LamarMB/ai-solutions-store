import { z } from "zod";

/** Сообщение диалога, как его видит провайдер. Только текст, без метаданных. */
export type ChatTurn = { role: "user" | "assistant"; text: string };

/** Рекомендация провайдера: только id решения из каталога и причина. */
export type ProviderRecommendation = { solutionId: string; reason: string };

export type ProviderReply = {
  text: string;
  recommendations: ProviderRecommendation[];
  /** Варианты быстрых ответов. */
  followUps: string[];
};

export type ProviderInfo = {
  id: string;
  /** mock — демонстрационный помощник на правилах, llm — языковая модель. */
  kind: "mock" | "llm";
  label: string;
};

/**
 * Сменный провайдер консультанта. Интерфейс не зависит от реализации:
 * mock сейчас, LLM — позже, без переписывания интерфейса.
 */
export interface ChatProvider {
  readonly info: ProviderInfo;
  reply(turns: readonly ChatTurn[]): Promise<ProviderReply>;
}

export const LIMITS = {
  messageMax: 1000,
  turnsMax: 30,
} as const;

/** Проверка истории, пришедшей от клиента. */
export const ChatHistorySchema = z
  .array(
    z.strictObject({
      role: z.enum(["user", "assistant"]),
      text: z.string().trim().min(1).max(4000),
    }),
  )
  .min(1)
  .max(LIMITS.turnsMax)
  .refine((turns) => turns.at(-1)?.role === "user", {
    message: "Последнее сообщение должно быть от пользователя",
  })
  .refine(
    (turns) =>
      turns.every(
        (t) => t.role !== "user" || t.text.length <= LIMITS.messageMax,
      ),
    { message: `Сообщение — не длиннее ${LIMITS.messageMax} символов` },
  );
