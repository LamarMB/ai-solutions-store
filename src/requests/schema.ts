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
/** Имя пользователя Telegram: 5–32 знака, латиница, цифры и «_», «@» — по желанию. */
const TELEGRAM_RE = /^@?[a-z0-9_]{5,32}$/i;

/** Убирает из телефона пробелы, скобки и дефисы. */
export function normalizePhone(value: string): string {
  return value.replace(/[\s()-]/g, "");
}

export const ContactMethodSchema = z.enum(
  ["email", "phone", "telegram"],
  "Выберите способ связи",
);
export type ContactMethod = z.infer<typeof ContactMethodSchema>;

const optionalId = z
  .string()
  .trim()
  .max(100)
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const RequestFormSchemaBase = z.strictObject({
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
});

export const RequestFormSchema = RequestFormSchemaBase.superRefine(
  checkContact,
  // Проверяем контакт даже при ошибках в других полях (например, без согласия),
  // чтобы пользователь сразу увидел все ошибки.
  { when: () => true },
).transform(normalizeContact);

/** Проверка контакта по выбранному способу связи. */
function checkContact(
  data: { contactMethod?: unknown; contact?: unknown },
  ctx: z.RefinementCtx,
) {
  // Выполняется и при ошибках в других полях: проверяем только то, что пришло.
  if (typeof data.contact !== "string" || data.contact.trim() === "") return;
  const contact = data.contact.trim();
  const message =
    data.contactMethod === "email" && !z.email().safeParse(contact).success
      ? "Укажите корректный email"
      : data.contactMethod === "phone" &&
          !PHONE_RE.test(normalizePhone(contact))
        ? "Укажите телефон: 10–15 цифр, можно с «+»"
        : data.contactMethod === "telegram" && !TELEGRAM_RE.test(contact)
          ? "Укажите имя пользователя Telegram, например @clinic_admin"
          : undefined;
  if (message) ctx.addIssue({ code: "custom", path: ["contact"], message });
}

function normalizeContact<
  T extends { contactMethod: ContactMethod; contact: string },
>(data: T): T {
  return {
    ...data,
    contact:
      data.contactMethod === "phone"
        ? normalizePhone(data.contact)
        : data.contactMethod === "telegram"
          ? `@${data.contact.replace(/^@/, "").toLowerCase()}`
          : data.contact.toLowerCase(),
  };
}

/**
 * Короткая заявка на демонстрацию с главной: имя, клиника, способ связи и
 * согласие. Описание задачи не требуется — обсуждается при связи.
 */
export const DemoRequestSchema = z
  .strictObject({
    name: RequestFormSchemaBase.shape.name,
    company: z
      .string()
      .trim()
      .min(2, "Укажите название клиники")
      .max(LIMITS.companyMax, `Не длиннее ${LIMITS.companyMax} символов`),
    contactMethod: ContactMethodSchema,
    contact: RequestFormSchemaBase.shape.contact,
    message: z
      .string()
      .trim()
      .max(500, "Не длиннее 500 символов")
      .optional()
      .transform((v) => v ?? ""),
    consent: RequestFormSchemaBase.shape.consent,
    solutionId: optionalId,
    packageId: optionalId,
  })
  .superRefine(checkContact, { when: () => true })
  .transform(normalizeContact);

/** Какая форма отправлена: короткая заявка на демонстрацию или полная. */
export const FORM_KIND_FIELD = "form";
export const DEMO_FORM = "demo";

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
