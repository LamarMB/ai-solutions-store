import { z } from "zod";
import { RED_FLAGS } from "@/bot/conversation/safety";
import { COMPLAINT_AREAS, QUESTION_KEYS } from "@/bot/conversation/triage";

/**
 * Что пациент может разрешить передать врачу своей записи: краткое описание
 * жалобы из разговора — не переписка. Хранится только в разговоре пациента
 * до его решения, после согласия — зашифрованно в disclosure_consents.
 */
export const ShareSummarySchema = z.strictObject({
  area: z.enum(COMPLAINT_AREAS),
  summary: z.string().max(160),
  trauma: z.enum(["yes", "no"]).optional(),
  duration: z.string().max(60).optional(),
  redFlags: z.array(z.enum(RED_FLAGS)),
  redFlagsDenied: z.boolean(),
});
export type ShareSummary = z.infer<typeof ShareSummarySchema>;

/** Длина текста обращения к администратору. */
export const REQUEST_TEXT_MAX = 500;

/**
 * Обращения к администратору с согласием пациента (src/bot/requests.ts). Без
 * порта (нет MEDICAL_DATA_KEY) бот зовёт администратора без передачи текста.
 */
export interface RequestPort {
  /** Сохраняет утверждённый пациентом текст; повтор — то же обращение. */
  create(peerId: number, text: string): { id: number; repeated: boolean };
  /** Отзыв: без id — все действующие обращения собеседника. */
  revoke(peerId: number, requestId?: number): number[];
  activeIds(peerId: number): number[];
}

/**
 * Согласия пациента на передачу сведений врачу (src/bot/consent.ts). Без
 * порта (нет MEDICAL_DATA_KEY) бот передачу не предлагает.
 */
export interface ConsentPort {
  /** false — запись не найдена среди активных записей собеседника. */
  share(peerId: number, bookingId: number, summary: ShareSummary): boolean;
  /** Отзыв: сведения удаляются сразу. */
  revoke(peerId: number, bookingId: number): boolean;
  /** Записи собеседника с действующим согласием. */
  sharedBookingIds(peerId: number): Set<number>;
}

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
  /**
   * Большой прайс: без s — выбор направления (p — страница списка), с s —
   * цены направления (s "" — услуги без специальности), p — страница цен.
   */
  z.strictObject({
    a: z.literal("pr"),
    s: z.string().max(40).optional(),
    p: z.int().min(0).max(200).optional(),
  }),
  /** Позвать администратора (с подтверждением) и подтверждение. */
  z.strictObject({ a: z.literal("admin") }),
  z.strictObject({ a: z.literal("hoff") }),
  /** Вернуться к боту после передачи администратору. */
  z.strictObject({ a: z.literal("bot") }),
  /** Ответ кнопкой на уточняющий вопрос о жалобе (только на текущий вопрос). */
  z.strictObject({
    a: z.literal("ans"),
    q: z.enum(QUESTION_KEYS),
    v: z.enum(["yes", "no"]),
  }),
  /** Ближайшее свободное время направления — на подтверждение, не запись. */
  z.strictObject({ a: z.literal("near"), s: z.string().max(40) }),
  /** Удалить историю разговора и начать заново. */
  z.strictObject({ a: z.literal("reset") }),
  /**
   * Необязательная передача описания жалобы врачу записи: показать, что уйдёт
   * (shr), согласиться (shrok), отказаться (shrno). Данные — из сохранённого
   * разговора, не из кнопки. Отзыв согласия по записи — rv.
   */
  z.strictObject({ a: z.literal("shr") }),
  z.strictObject({ a: z.literal("shrok") }),
  z.strictObject({ a: z.literal("shrno") }),
  z.strictObject({ a: z.literal("rv"), b: z.int().positive() }),
  /**
   * Открыть VK Mini App клиники. Канал ВКонтакте рисует её кнопкой open_app;
   * если приложение недоступно, кнопка заменяется записью через бота.
   */
  z.strictObject({ a: z.literal("app") }),
  /**
   * Обращение к администратору с согласием: разрешить передачу показанного
   * текста (hok), не разрешить (hno), написать заново (hedit), отозвать (hrv).
   * Текст — только из сохранённого шага, не из кнопки.
   */
  /** h — первые 12 знаков SHA-256 показанного текста: согласие на него и только на него. */
  z.strictObject({
    a: z.literal("hok"),
    h: z.string().regex(/^[0-9a-f]{12}$/),
  }),
  z.strictObject({ a: z.literal("hno") }),
  z.strictObject({ a: z.literal("hedit") }),
  z.strictObject({ a: z.literal("hrv"), r: z.int().positive() }),
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
  /** Пациент пишет, что передать администратору. */
  z.strictObject({ step: z.literal("handoff_compose") }),
  /** Предпросмотр текста обращения и вопрос о согласии. */
  z.strictObject({
    step: z.literal("handoff_consent"),
    draft: z.string().min(1).max(REQUEST_TEXT_MAX),
    /** Телефоны и почта убраны из текста. */
    redacted: z.boolean(),
  }),
  z.strictObject({
    step: z.literal("share"),
    bookingId: z.int().positive(),
    summary: ShareSummarySchema,
  }),
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

/**
 * Побочные эффекты шага, которые выполняет обёртка бота, а не диалог:
 * передача администратору и отметка о созданной записи.
 */
export type Effect =
  /** Позвать администратора; requestId — обращение с согласием, если есть. */
  | { type: "handoff"; requestId?: number }
  | { type: "booked"; bookingId: number };
