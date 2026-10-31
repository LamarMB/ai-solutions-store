import type { Solution } from "@/catalog/schema";
import {
  DEMO_FORM,
  DemoRequestSchema,
  fieldErrors,
  FORM_KIND_FIELD,
  formDataToInput,
  RequestFormSchema,
  SERVICE_FIELDS,
} from "@/requests/schema";
import type { RateLimiter } from "@/requests/rate-limit";
import type { SubmitState } from "@/requests/state";
import type { RequestRecord, RequestStore } from "@/requests/store";

/** Минимальное время заполнения формы: быстрее заполняют только боты. */
export const MIN_FILL_MS = 3_000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SubmitDeps = {
  store: RequestStore;
  limiter: RateLimiter;
  idempotency: {
    get(key: string): SubmitState | undefined;
    set(key: string, value: SubmitState): void;
  };
  solutions: readonly Solution[];
  /** Ключ клиента для ограничения частоты (хэш адреса, не сам адрес). */
  clientKey: string;
  now: () => number;
  newId: () => string;
  log: (message: string) => void;
};

/**
 * Обработка заявки. Порядок: повтор → частота → антиспам → схема →
 * каталог → сохранение. В лог попадают только id и режим, без контактов.
 */
export async function handleSubmission(
  fd: FormData,
  deps: SubmitDeps,
): Promise<SubmitState> {
  const submissionId = String(fd.get(SERVICE_FIELDS.submissionId) ?? "");
  if (!UUID_RE.test(submissionId)) {
    return {
      status: "error",
      message: "Обновите страницу и попробуйте снова.",
    };
  }

  // Повторная отправка той же формы возвращает прежний результат.
  const previous = deps.idempotency.get(submissionId);
  if (previous) return previous;

  if (!deps.limiter.attempt(deps.clientKey)) {
    return {
      status: "rate_limited",
      message:
        "Слишком много попыток. Подождите несколько минут и попробуйте снова.",
    };
  }

  // Ловушка для ботов: скрытое поле должно остаться пустым.
  // Боту отвечаем как обычно, но ничего не сохраняем.
  const honeypot = String(fd.get(SERVICE_FIELDS.honeypot) ?? "");
  if (honeypot !== "") {
    const fake: SubmitState = {
      status: "accepted",
      mode: deps.store.mode,
      reference: deps.newId(),
    };
    deps.idempotency.set(submissionId, fake);
    return fake;
  }

  const startedAt = Number(fd.get(SERVICE_FIELDS.startedAt));
  const elapsed = deps.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsed > MAX_FORM_AGE_MS) {
    return { status: "error", message: "Форма устарела. Обновите страницу." };
  }
  if (elapsed < MIN_FILL_MS) {
    return {
      status: "too_fast",
      message:
        "Форма отправлена слишком быстро. Проверьте данные и отправьте ещё раз.",
    };
  }

  const demo = fd.get(FORM_KIND_FIELD) === DEMO_FORM;
  const schema = demo ? DemoRequestSchema : RequestFormSchema;
  const parsed = schema.safeParse(formDataToInput(fd));
  if (!parsed.success) {
    return {
      status: "invalid",
      fieldErrors: fieldErrors(parsed.error),
      message: "Проверьте поля формы.",
    };
  }
  const data = parsed.data;

  // Решение и пакет проверяем по каталогу; неизвестное отбрасываем.
  const solution = deps.solutions.find((s) => s.id === data.solutionId);
  const pkg = solution?.packages.find((p) => p.id === data.packageId);
  const record: RequestRecord = {
    id: deps.newId(),
    createdAt: new Date(deps.now()).toISOString(),
    items: solution
      ? [{ solutionId: solution.id, packageId: pkg?.id ?? null }]
      : [],
    contact: {
      name: data.name,
      ...(data.company ? { company: data.company } : {}),
      method: data.contactMethod,
      value: data.contact,
    },
    message: data.message,
    source: demo
      ? "главная страница, «Получить демонстрацию»"
      : "страница заявки /request",
  };

  try {
    await deps.store.save(record);
  } catch {
    deps.log(`[requests] save failed id=${record.id} mode=${deps.store.mode}`);
    return {
      status: "error",
      message: "Не удалось обработать заявку. Попробуйте позже.",
    };
  }

  deps.log(
    `[requests] accepted id=${record.id} mode=${deps.store.mode} items=${record.items.length}`,
  );
  const result: SubmitState = {
    status: "accepted",
    mode: deps.store.mode,
    reference: record.id,
  };
  deps.idempotency.set(submissionId, result);
  return result;
}
