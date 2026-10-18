import { z } from "zod";
import { BOOKING_STATUSES } from "@/bot/storage/types";
import { isDate, isTime, toMinutes } from "@/bot/schedule/time";

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
  source: z.enum(["vk", "admin"]).optional(),
  query: z.string().trim().max(60).optional(),
});

export const BookingCreateSchema = z.object({
  doctorId: id,
  date,
  time,
  note: text(0, 120, "Пометка").optional(),
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
        title: text(2, 100, "Название услуги"),
        specialtyId: z.string().max(40),
        priceRub: price,
      }),
    )
    .max(50, "Не больше 50 услуг"),
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
