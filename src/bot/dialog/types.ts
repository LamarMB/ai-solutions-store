import { z } from "zod";

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

/** Намерение свободного текста. Сейчас — правила, позже — LLM. */
export type Intent =
  | "start"
  | "menu"
  | "book"
  | "my_bookings"
  | "admin"
  | "medical"
  | "yes"
  | "no"
  | "unknown";

export interface TextInterpreter {
  interpret(text: string): Intent | Promise<Intent>;
}
