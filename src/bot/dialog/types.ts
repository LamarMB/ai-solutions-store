import { z } from "zod";

/** Темы справки: ответы строятся только из данных клиники. */
export const INFO_TOPICS = [
  "prices",
  "doctors",
  "address",
  "prep",
  "route",
] as const;
export type InfoTopic = (typeof INFO_TOPICS)[number];

/**
 * Действие кнопки. Короткие ключи: payload кнопки ВКонтакте ограничен по длине.
 * Действия «ok» (подтвердить запись) и «cxok» (подтвердить отмену) не несут данных —
 * бронирование и отмена берутся из сохранённого состояния, а не из кнопки.
 */
export const ActionSchema = z.discriminatedUnion("a", [
  z.strictObject({ a: z.literal("menu") }),
  z.strictObject({ a: z.literal("book") }),
  z.strictObject({ a: z.literal("my") }),
  z.strictObject({ a: z.literal("back") }),
  z.strictObject({ a: z.literal("spec"), s: z.string().max(40) }),
  z.strictObject({ a: z.literal("doc"), d: z.string().max(40) }),
  z.strictObject({ a: z.literal("day"), dt: z.string().max(10) }),
  z.strictObject({ a: z.literal("time"), t: z.string().max(5) }),
  z.strictObject({ a: z.literal("more") }),
  z.strictObject({ a: z.literal("ok") }),
  z.strictObject({ a: z.literal("cx"), b: z.int().positive() }),
  z.strictObject({ a: z.literal("cxok") }),
  /** Справка из данных клиники. */
  z.strictObject({ a: z.literal("info"), k: z.enum(INFO_TOPICS) }),
  /** Позвать администратора (с подтверждением) и подтверждение. */
  z.strictObject({ a: z.literal("admin") }),
  z.strictObject({ a: z.literal("hoff") }),
  /** Вернуться к боту после передачи администратору. */
  z.strictObject({ a: z.literal("bot") }),
]);
export type Action = z.infer<typeof ActionSchema>;

/** Состояние диалога. Хранится в SessionStore и проверяется схемой при загрузке. */
export const DialogStateSchema = z.discriminatedUnion("step", [
  z.strictObject({ step: z.literal("menu") }),
  z.strictObject({ step: z.literal("specialty") }),
  z.strictObject({ step: z.literal("doctor"), specialtyId: z.string() }),
  z.strictObject({
    step: z.literal("day"),
    specialtyId: z.string(),
    doctorId: z.string(),
  }),
  z.strictObject({
    step: z.literal("time"),
    specialtyId: z.string(),
    doctorId: z.string(),
    date: z.string(),
    page: z.int().nonnegative(),
  }),
  z.strictObject({
    step: z.literal("confirm"),
    specialtyId: z.string(),
    doctorId: z.string(),
    date: z.string(),
    time: z.string(),
  }),
  z.strictObject({ step: z.literal("bookings") }),
  z.strictObject({ step: z.literal("cancel"), bookingId: z.int().positive() }),
  z.strictObject({ step: z.literal("handoff") }),
]);
export type DialogState = z.infer<typeof DialogStateSchema>;

export const INITIAL_STATE: DialogState = { step: "menu" };

/** Входящее событие от любого канала (ВКонтакте, симулятор, тесты). */
export type BotEvent =
  | { type: "start" }
  /** Показать текущий шаг без сброса (возврат в диалог, перезапуск канала). */
  | { type: "resume" }
  | { type: "text"; text: string }
  /** Нажатие кнопки: payload ещё не проверен. */
  | { type: "action"; payload: unknown };

export type ButtonColor = "primary" | "secondary" | "positive" | "negative";

export type Button = { label: string; action: Action; color?: ButtonColor };

/** Ответ бота: текст и кнопки рядами. Канал сам превращает их в свой формат. */
export type Reply = { text: string; buttons: Button[][] };

/** Намерение свободного текста. */
export const INTENTS = [
  "greeting",
  "menu",
  "book",
  "my_bookings",
  "question",
  "admin",
  "medical",
  "yes",
  "no",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

/**
 * Разбор свободного текста. Параметры записи — только подсказка: бот проверяет
 * их по расписанию и всегда просит подтвердить запись кнопкой.
 */
export type Interpretation = {
  intent: Intent;
  specialtyId?: string;
  doctorId?: string;
  /** «ГГГГ-ММ-ДД». */
  date?: string;
  /** «ЧЧ:ММ». */
  time?: string;
  /** Тема справки, если вопрос типовой. */
  topic?: InfoTopic;
  /** Ответ на вопрос из данных клиники (только от модели, проверяется длина). */
  answer?: string;
};

/** Что известно интерпретатору о диалоге — без истории и личных данных. */
export type InterpretContext = {
  peerId: number;
  /** Сегодняшняя дата клиники «ГГГГ-ММ-ДД» и день недели. */
  today: string;
  step: DialogState["step"];
};

/** Разбор текста. Сейчас — правила или OpenAI; канал о нём не знает. */
export interface TextInterpreter {
  interpret(
    text: string,
    context: InterpretContext,
  ): Interpretation | Promise<Interpretation>;
}

/** Побочные эффекты шага, которые выполняет обёртка бота, а не диалог. */
export type Effect = { type: "handoff" };
