import { z } from "zod";
import { RED_FLAGS, URGENCY } from "@/bot/conversation/safety";
import { COMPLAINT_AREAS, QUESTION_KEYS } from "@/bot/conversation/triage";
import {
  DialogStateSchema,
  INITIAL_STATE,
  ShareSummarySchema,
  type DialogState,
} from "@/bot/dialog/types";

/** Сколько реплик помнит бот (для модели и продолжения разговора). */
export const HISTORY_TURNS = 12;
/** Длина одной сохранённой реплики. */
export const TURN_MAX = 300;

const TurnSchema = z.object({
  role: z.enum(["patient", "bot"]),
  text: z.string().max(TURN_MAX),
});
export type Turn = z.infer<typeof TurnSchema>;

/**
 * Память разговора: только то, что нужно для маршрутизации и записи. Хранится в SQLite вместе с шагом записи, удаляется
 * по сроку (BOT_HISTORY_HOURS) и по команде «сброс». В журнал не пишется.
 */
export const ConversationSchema = z.object({
  complaint: z
    .object({
      area: z.enum(COMPLAINT_AREAS),
      summary: z.string().max(160),
      /** Другие области в том же сообщении — специалиста выбирает пациент. */
      others: z.array(z.enum(COMPLAINT_AREAS)).max(5).optional(),
    })
    .optional(),
  trauma: z.enum(["yes", "no"]).optional(),
  duration: z.string().max(60).optional(),
  /** Тревожные признаки, которые описал пациент. */
  redFlags: z.array(z.enum(RED_FLAGS)).default([]),
  /** Пациент ответил, что тревожных признаков нет. */
  redFlagsDenied: z.boolean().default(false),
  /** Какие вопросы уже задавались — повторно не задаются. */
  asked: z.array(z.enum(QUESTION_KEYS)).default([]),
  /** Вопрос из последнего ответа бота: к нему относятся «нет», «три дня». */
  pending: z.enum(QUESTION_KEYS).optional(),
  urgency: z.enum(URGENCY).default("none"),
  /** Направление, предложенное или выбранное в разговоре. */
  specialtyId: z.string().max(40).optional(),
  history: z.array(TurnSchema).max(HISTORY_TURNS).default([]),
  /** Сколько посторонних сообщений подряд (без их текста). */
  offtopicStreak: z.number().int().nonnegative().default(0),
  /** До этого момента бот не отвечает на повторный оффтоп (ISO). */
  mutedUntil: z.string().optional(),
  /**
   * Предложение передать врачу описание жалобы после записи. Ничего не
   * передаётся, пока пациент сам не нажмёт «Передать врачу».
   */
  shareOffer: z
    .object({ bookingId: z.int().positive(), summary: ShareSummarySchema })
    .optional(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const emptyConversation = (): Conversation =>
  ConversationSchema.parse({});

/** Память о жалобе сбрасывается, история реплик сохраняется. */
export const withoutComplaint = (conv: Conversation): Conversation => ({
  ...emptyConversation(),
  history: conv.history,
});

/** Сессия собеседника: шаг записи (flow) и память разговора (conv). */
export type Session = { flow: DialogState; conv: Conversation };

const SessionSchema = z.object({
  v: z.literal(2),
  flow: DialogStateSchema,
  conv: ConversationSchema,
});

export const newSession = (): Session => ({
  flow: INITIAL_STATE,
  conv: emptyConversation(),
});

export const serializeSession = (session: Session) => ({ v: 2, ...session });

/**
 * Читает сохранённую сессию. Формат v1 (только шаг записи) читается как
 * шаг без памяти разговора; испорченные данные — как новый разговор.
 */
export function parseSession(raw: unknown): Session {
  const v2 = SessionSchema.safeParse(raw);
  if (v2.success) return { flow: v2.data.flow, conv: v2.data.conv };
  const v1 = DialogStateSchema.safeParse(raw);
  if (v1.success) return { flow: v1.data, conv: emptyConversation() };
  return newSession();
}

export function addTurn(
  conv: Conversation,
  role: Turn["role"],
  text: string,
): Conversation {
  const turn = {
    role,
    text: text.replace(/\s+/g, " ").trim().slice(0, TURN_MAX),
  };
  if (!turn.text) return conv;
  return { ...conv, history: [...conv.history, turn].slice(-HISTORY_TURNS) };
}
