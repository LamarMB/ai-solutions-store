import { z } from "zod";
import { redactContacts } from "@/consultant/privacy";
import type { Clinic } from "@/bot/clinic/types";
import type { Conversation } from "@/bot/conversation/memory";
import {
  isUnsafeReply,
  RED_FLAGS,
  URGENCY,
  type RedFlag,
  type Urgency,
} from "@/bot/conversation/safety";
import {
  COMPLAINT_AREAS,
  QUESTION_KEYS,
  type ComplaintArea,
  type QuestionKey,
} from "@/bot/conversation/triage";
import {
  INFO_TOPICS,
  type DialogState,
  type InfoTopic,
} from "@/bot/dialog/types";
import { isDate, isTime } from "@/bot/schedule/time";

/**
 * Действия, которые может выбрать модель. Это просьбы к программе, а не
 * команды базе: каждое действие выполняют проверенные сервисы расписания.
 * Подтверждения и отмены записи среди них нет — только кнопкой или «да» на шаге
 * подтверждения.
 */
export const MODEL_ACTIONS = [
  "ask_clarification",
  "answer_clinic_question",
  "suggest_specialty",
  "list_doctors",
  "list_available_slots",
  "nearest_slot",
  "start_booking",
  "show_bookings",
  "handoff_to_admin",
  "urgent_care_guidance",
  "decline_medical_advice",
  "specialist_unavailable",
  "small_talk",
  /** Посторонняя тема или попытка сменить роль — программа отвечает шаблоном. */
  "out_of_scope",
] as const;
export type ModelAction = (typeof MODEL_ACTIONS)[number];

/** Проверенное решение модели: все id есть в справочнике, даты корректны. */
export type ModelDecision = {
  action: ModelAction;
  /** Текст для пациента; пустой, если ответ модели отклонён фильтром. */
  reply: string;
  question?: QuestionKey;
  complaint?: { area: ComplaintArea; summary: string };
  trauma?: "yes" | "no";
  duration?: string;
  redFlags: RedFlag[];
  redFlagsDenied: boolean;
  specialtyId?: string;
  doctorId?: string;
  date?: string;
  time?: string;
  infoTopic?: InfoTopic;
  urgency: Urgency;
  /** Пациент сменил тему: прежняя жалоба больше не обсуждается. */
  newTopic: boolean;
};

export type ConversationInput = {
  peerId: number;
  /** «ГГГГ-ММ-ДД» по часовому поясу клиники. */
  today: string;
  /** Сообщение пациента (контакты уже скрыты). */
  text: string;
  flow: DialogState;
  conv: Conversation;
};

/** Разговорная модель. undefined — модель недоступна, бот работает по правилам. */
export interface ConversationModel {
  decide(input: ConversationInput): Promise<ModelDecision | undefined>;
}

export const REPLY_MAX = 600;

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

/** Сырой ответ модели по JSON-схеме (все поля обязательны, «нет» — null). */
const RawDecisionSchema = z.object({
  action: z.enum(MODEL_ACTIONS),
  reply: z.string(),
  question: nullable(z.enum(QUESTION_KEYS)),
  complaint_area: nullable(z.enum(COMPLAINT_AREAS)),
  complaint_summary: nullable(z.string()),
  trauma: nullable(z.enum(["yes", "no"])),
  duration: nullable(z.string()),
  red_flags: z.array(z.enum(RED_FLAGS)),
  red_flags_denied: z.boolean(),
  specialty_id: nullable(z.string()),
  doctor_id: nullable(z.string()),
  date: nullable(z.string()),
  time: nullable(z.string()),
  info_topic: nullable(z.enum(INFO_TOPICS)),
  urgency: z.enum(URGENCY),
  new_topic: z.boolean(),
});

/** JSON Schema для Structured Outputs (strict). */
export function decisionJsonSchema(clinic: Clinic) {
  const nullableEnum = (values: readonly string[]) => ({
    type: ["string", "null"],
    enum: [...values, null],
  });
  const properties = {
    action: { type: "string", enum: [...MODEL_ACTIONS] },
    reply: {
      type: "string",
      description:
        "Короткий ответ пациенту по-русски, 1–3 предложения, без списков врачей, времени и цен",
    },
    question: nullableEnum(QUESTION_KEYS),
    complaint_area: nullableEnum(COMPLAINT_AREAS),
    complaint_summary: { type: ["string", "null"] },
    trauma: nullableEnum(["yes", "no"]),
    duration: { type: ["string", "null"] },
    red_flags: {
      type: "array",
      items: { type: "string", enum: [...RED_FLAGS] },
    },
    red_flags_denied: { type: "boolean" },
    specialty_id: nullableEnum(clinic.specialties.map((s) => s.id)),
    doctor_id: nullableEnum(clinic.doctors.map((d) => d.id)),
    date: { type: ["string", "null"], description: "ГГГГ-ММ-ДД" },
    time: { type: ["string", "null"], description: "ЧЧ:ММ" },
    info_topic: nullableEnum(INFO_TOPICS),
    urgency: { type: "string", enum: [...URGENCY] },
    new_topic: { type: "boolean" },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/**
 * Проверяет ответ модели. Неизвестное действие или поле — весь ответ
 * отбрасывается (бот перейдёт к правилам); несуществующие врачи, направления
 * и даты — убираются; небезопасный текст — заменяется пустым.
 */
export function sanitizeDecision(
  raw: unknown,
  clinic: Clinic,
): ModelDecision | undefined {
  const parsed = RawDecisionSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const m = parsed.data;
  const reply = m.reply.trim().slice(0, REPLY_MAX);
  const doctor = clinic.doctors.find((d) => d.id === m.doctor_id);
  const specialtyId =
    doctor?.specialtyId ??
    clinic.specialties.find((s) => s.id === m.specialty_id)?.id;
  const decision: ModelDecision = {
    action: m.action,
    reply: isUnsafeReply(reply) ? "" : reply,
    redFlags: [...new Set(m.red_flags)],
    redFlagsDenied: m.red_flags_denied,
    urgency: m.urgency,
    newTopic: m.new_topic,
  };
  if (m.question) decision.question = m.question;
  if (m.complaint_area) {
    // Контакты не храним в памяти разговора, даже если модель их повторила.
    const summary = redactContacts((m.complaint_summary ?? "").trim()).text;
    decision.complaint = {
      area: m.complaint_area,
      summary: summary.slice(0, 120),
    };
  }
  if (m.trauma) decision.trauma = m.trauma;
  const duration = m.duration?.trim();
  if (duration) decision.duration = duration.slice(0, 40);
  if (specialtyId) decision.specialtyId = specialtyId;
  if (doctor) decision.doctorId = doctor.id;
  if (m.date && isDate(m.date)) decision.date = m.date;
  if (m.time && isTime(m.time)) decision.time = m.time;
  if (m.info_topic) decision.infoTopic = m.info_topic;
  return decision;
}
