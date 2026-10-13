import { z } from "zod";

/**
 * Схема заявки — общая для клиента и сервера.
 * Минимум персональных данных: имя, способ связи и контакт, компания — по желанию.
 */
export const LIMITS = {
  nameMax: 100,
  companyMax: 150,
  contactMax: 254,
  messageMin: 10,
  messageMax: 2000,
} as const;

const PHONE_RE = /^\+?\d{10,15}$/;

/** Убирает из телефона пробелы, скобки и дефисы. */
export function normalizePhone(value: string): string {
  return value.replace(/[\s()-]/g, "");
}

export const ContactMethodSchema = z.enum(
  ["email", "phone"],
  "Выберите способ связи",
);
export type ContactMethod = z.infer<typeof ContactMethodSchema>;

const optionalId = z
  .string()
  .trim()
  .max(100)
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const RequestFormSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(2, "Укажите имя — не короче 2 символов")
      .max(LIMITS.nameMax, `Имя — не длиннее ${LIMITS.nameMax} символов`),
    company: z
      .string()
      .trim()
      .max(LIMITS.companyMax, `Не длиннее ${LIMITS.companyMax} символов`)
      .optional()
      .transform((v) => (v ? v : undefined)),
    contactMethod: ContactMethodSchema,
    contact: z
      .string()
      .trim()
      .min(1, "Укажите контакт для связи")
      .max(LIMITS.contactMax),
    message: z
      .string()
      .trim()
      .min(
        LIMITS.messageMin,
        `Опишите задачу — не короче ${LIMITS.messageMin} символов`,
      )
      .max(LIMITS.messageMax, `Не длиннее ${LIMITS.messageMax} символов`),
    consent: z.literal(true, "Нужно согласие на обработку персональных данных"),
    solutionId: optionalId,
    packageId: optionalId,
  })
  .superRefine(
    (data, ctx) => {
      // Выполняется и при ошибках в других полях: проверяем только то, что пришло.
      if (typeof data.contact !== "string" || data.contact.trim() === "")
        return;
      if (data.contactMethod === "email") {
        if (!z.email().safeParse(data.contact).success) {
          ctx.addIssue({
            code: "custom",
            path: ["contact"],
            message: "Укажите корректный email",
          });
        }
      } else if (
        data.contactMethod === "phone" &&
        !PHONE_RE.test(normalizePhone(data.contact))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["contact"],
          message: "Укажите телефон: 10–15 цифр, можно с «+»",
        });
      }
    },
    // Проверяем контакт даже при ошибках в других полях (например, без согласия),
    // чтобы пользователь сразу увидел все ошибки.
    { when: () => true },
  )
  .transform((data) => ({
    ...data,
    contact:
      data.contactMethod === "phone"
        ? normalizePhone(data.contact)
        : data.contact.toLowerCase(),
  }));

export type RequestFormInput = z.input<typeof RequestFormSchema>;
export type RequestFormData = z.output<typeof RequestFormSchema>;
export type RequestField =
  "name" | "company" | "contactMethod" | "contact" | "message" | "consent";

/** Служебные поля формы: защита от спама и повторной отправки. */
export const SERVICE_FIELDS = {
  honeypot: "website",
  startedAt: "startedAt",
  submissionId: "submissionId",
} as const;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** Извлекает поля заявки из FormData (одинаково на клиенте и сервере). */
export function formDataToInput(fd: FormData): Record<string, unknown> {
  return {
    name: str(fd, "name"),
    company: str(fd, "company"),
    contactMethod: str(fd, "contactMethod"),
    contact: str(fd, "contact"),
    message: str(fd, "message"),
    consent: fd.get("consent") === "on",
    solutionId: str(fd, "solutionId"),
    packageId: str(fd, "packageId"),
  };
}

/** Первая ошибка по каждому полю — для показа рядом с полем. */
export function fieldErrors(
  error: z.ZodError,
): Partial<Record<RequestField, string>> {
  const result: Partial<Record<RequestField, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as RequestField | undefined;
    if (field && !result[field]) result[field] = issue.message;
  }
  return result;
}
