import { z } from "zod";
import { BOOKING_STATUSES } from "@/bot/storage/types";
import { isDate, isTime, toMinutes } from "@/bot/schedule/time";
import { STAFF_ROLES } from "@/bot/storage/admin-store";
import { SERVICES_MAX } from "@/bot/clinic/types";
import {
  detectRedFlags,
  detectTrauma,
  isMedicalAdviceRequest,
} from "@/bot/conversation/safety";
import { detectComplaint } from "@/bot/conversation/triage";

/**
 * Проверка всех данных из админ-панели на сервере. Сообщения — по-русски,
 * для администратора клиники.
 */
const text = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label}: заполните поле` })
    .trim()
    .min(min, min > 0 ? `${label}: не короче ${min} символов` : undefined)
    .max(max, `${label}: не длиннее ${max} символов`);

const date = z
  .string({ error: "Укажите дату" })
  .refine(isDate, "Дата в формате ГГГГ-ММ-ДД");
const time = z
  .string({ error: "Укажите время" })
  .refine(isTime, "Время в формате ЧЧ:ММ");
const id = z.string().trim().min(1).max(40);
const price = z
  .number({ error: "Стоимость — число" })
  .int("Стоимость — целое число рублей")
  .min(0, "Стоимость не может быть отрицательной")
  .max(1_000_000, "Слишком большая стоимость");

export const LoginSchema = z.object({
  login: z.string().trim().min(1, "Введите логин").max(64),
  password: z.string().min(1, "Введите пароль").max(200),
});

export const BookingFilterSchema = z.object({
  from: date.optional(),
  to: date.optional(),
  doctorId: id.optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  source: z.enum(["vk", "admin", "miniapp"]).optional(),
  query: z.string().trim().max(60).optional(),
});

/**
 * Пометка записи — организационная («перезвонить», «первичный приём»).
 * Жалобы, симптомы, контакты сюда не пишутся: пометку видят все
 * администраторы, а медицинские сведения — только врач по согласию пациента.
 * Проверка эвристическая, она ловит очевидное, но не всё — правило
 * дублируется подсказкой в интерфейсе.
 */
export function noteProblem(note: string): string | undefined {
  if (/@|\d[\d\s()+-]{6,}\d/.test(note))
    return "Пометка: без телефонов и адресов почты";
  if (
    detectComplaint(note) ||
    detectRedFlags(note).length > 0 ||
    detectTrauma(note) === "yes" ||
    isMedicalAdviceRequest(note)
  )
    return "Пометка: без жалоб и медицинских сведений — их видят все администраторы";
  return undefined;
}

export const BookingCreateSchema = z.object({
  doctorId: id,
  date,
  time,
  note: text(0, 120, "Пометка")
    .superRefine((note, ctx) => {
      const problem = noteProblem(note);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    })
    .optional(),
});

export const BookingUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("complete") }),
  z.object({
    action: z.literal("reschedule"),
    doctorId: id,
    date,
    time,
  }),
]);

export const DoctorSchema = z.object({
  name: text(2, 80, "Имя врача"),
  specialtyId: id,
  about: text(0, 300, "Описание"),
  slotMinutes: z
    .number({ error: "Длительность приёма — число минут" })
    .int()
    .min(10, "Приём — не короче 10 минут")
    .max(180, "Приём — не длиннее 180 минут")
    .refine((m) => m % 5 === 0, "Длительность приёма кратна 5 минутам"),
  priceRub: price.nullable(),
});

export const DoctorPatchSchema = z.union([
  DoctorSchema,
  z.object({ active: z.boolean() }),
]);

export const SpecialtySchema = z.object({
  title: text(2, 60, "Название специальности"),
  toWhom: text(2, 80, "Как писать «к кому» (например, «к терапевту»)"),
});

const interval = z
  .object({ from: time, to: time })
  .refine((h) => toMinutes(h.from) < toMinutes(h.to), {
    message: "Начало должно быть раньше конца",
  });

export const HoursSchema = z
  .object({
    hours: z
      .array(
        interval.and(z.object({ weekday: z.number().int().min(1).max(7) })),
      )
      .max(21, "Слишком много интервалов"),
  })
  .refine(
    ({ hours }) =>
      hours.every((a, i) =>
        hours.every(
          (b, j) =>
            i === j ||
            a.weekday !== b.weekday ||
            toMinutes(a.to) <= toMinutes(b.from) ||
            toMinutes(b.to) <= toMinutes(a.from),
        ),
      ),
    { message: "Интервалы одного дня не должны пересекаться" },
  );

export const ExceptionSchema = z
  .object({
    doctorId: id.nullable(),
    date,
    from: time.nullable(),
    to: time.nullable(),
    reason: text(0, 100, "Причина"),
  })
  .refine((e) => (e.from === null) === (e.to === null), {
    message: "Укажите и начало, и конец интервала — или отметьте весь день",
  })
  .refine(
    (e) =>
      e.from === null || e.to === null || toMinutes(e.from) < toMinutes(e.to),
    {
      message: "Начало должно быть раньше конца",
    },
  );

export const SettingsSchema = z.object({
  settings: z.object({
    name: text(2, 100, "Название клиники"),
    address: text(2, 200, "Адрес"),
    phone: text(0, 30, "Телефон").refine(
      (p) => /^[0-9+()\-\s]*$/.test(p),
      "Телефон: только цифры, пробелы, +, ( ) и -",
    ),
    workingHours: text(2, 120, "Режим работы"),
    route: text(0, 500, "Как добраться"),
    about: text(0, 1000, "Описание клиники и услуг"),
    visitTips: z
      .array(text(1, 200, "Пункт памятки"))
      .max(10, "Памятка — не больше 10 пунктов"),
  }),
  services: z
    .array(
      z.object({
        /** Номер услуги в базе: есть — обновляется она же, нет — новая услуга. */
        id: z.int().positive().optional(),
        title: text(2, 100, "Название услуги"),
        specialtyId: z.string().max(40),
        priceRub: price,
      }),
    )
    .max(SERVICES_MAX, `Не больше ${SERVICES_MAX} услуг`)
    .refine(
      (list) => {
        const ids = list.flatMap((s) => (s.id ? [s.id] : []));
        return new Set(ids).size === ids.length;
      },
      { message: "Услуга повторяется в списке — обновите страницу" },
    ),
});

const staffLogin = z
  .string({ error: "Укажите логин" })
  .trim()
  .regex(
    /^[a-zA-Z0-9._-]{3,64}$/,
    "Логин: латиница, цифры, точка, дефис, подчёркивание (3–64 символа)",
  );

export const InviteSchema = z
  .object({
    login: staffLogin,
    role: z.enum(STAFF_ROLES, { error: "Выберите роль" }),
    doctorId: id.nullable().default(null),
  })
  .refine((v) => v.role !== "doctor" || v.doctorId !== null, {
    message: "Для роли «Врач» выберите врача расписания",
    path: ["doctorId"],
  });

export const StaffPatchSchema = z.union([
  z
    .object({
      role: z.enum(STAFF_ROLES, { error: "Выберите роль" }),
      doctorId: id.nullable().default(null),
    })
    .refine((v) => v.role !== "doctor" || v.doctorId !== null, {
      message: "Для роли «Врач» выберите врача расписания",
      path: ["doctorId"],
    }),
  z.object({ disabled: z.boolean() }),
]);

export const RequestUpdateSchema = z.strictObject({
  action: z.literal("done"),
});

export const InviteAcceptSchema = z.object({
  token: z.string().trim().min(20).max(100),
  password: z.string().min(1, "Введите пароль").max(200),
});

/** Первое понятное сообщение об ошибке и ошибки по полям. */
export function describeZodError(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return {
    message: error.issues[0]?.message ?? "Проверьте введённые данные",
    fields,
  };
}
