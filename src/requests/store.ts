import { privacyPolicy } from "@/content/privacy";

/**
 * Хранилище заявок. Заявка — черновик заказа: позиции «решение + пакет»,
 * чтобы позже добавить корзину и оплату без переписывания.
 */
export type RequestItem = { solutionId: string; packageId: string | null };

export type RequestRecord = {
  id: string;
  createdAt: string;
  items: RequestItem[];
  contact: {
    name: string;
    company?: string;
    method: "email" | "phone" | "telegram";
    value: string;
  };
  message: string;
  /** Откуда заявка: форма на главной или страница /request. */
  source: string;
};

/**
 * Режим приёма: test — данные проверяются, но не сохраняются и не передаются;
 * live — заявка доставляется владельцу (TelegramRequestStore).
 */
export type IntakeMode = "test" | "live";

export interface RequestStore {
  readonly mode: IntakeMode;
  save(record: RequestRecord): Promise<void>;
}

/**
 * Тестовый адаптер: НЕ сохраняет и НЕ передаёт персональные данные.
 * Запоминает только число принятых заявок — для тестов и диагностики.
 */
export class TestRequestStore implements RequestStore {
  readonly mode = "test" as const;
  private accepted = 0;

  async save(record: RequestRecord): Promise<void> {
    void record; // данные намеренно отбрасываются
    this.accepted += 1;
  }

  get acceptedCount() {
    return this.accepted;
  }
}

const METHOD_LABELS = {
  email: "email",
  phone: "телефон",
  telegram: "Telegram",
};

/** Текст сообщения о заявке: без разметки, чтобы данные заявки не стали ссылками или командами. */
export function requestMessage(record: RequestRecord): string {
  const { contact } = record;
  return [
    "Заявка с сайта",
    `Источник: ${record.source}`,
    `Номер: ${record.id}`,
    `Имя: ${contact.name}`,
    ...(contact.company ? [`Клиника: ${contact.company}`] : []),
    `Связь (${METHOD_LABELS[contact.method]}): ${contact.value}`,
    ...(record.message ? [`Комментарий: ${record.message}`] : []),
    ...record.items.map(
      (i) =>
        `Решение: ${i.solutionId}${i.packageId ? `, тариф ${i.packageId}` : ""}`,
    ),
    `Согласие на обработку персональных данных получено: ${record.createdAt}`,
  ].join("\n");
}

/**
 * Ошибка доставки с причиной для журнала: без токена и данных заявки.
 * `uncertain` — ответ не получен (тайм-аут или обрыв после отправки): заявка
 * могла дойти, повторная отправка может её задублировать.
 */
export class DeliveryError extends Error {
  constructor(
    readonly reason: string,
    readonly uncertain: boolean,
  ) {
    super(`delivery failed: ${reason}`);
    this.name = "DeliveryError";
  }
}

/** Причина сетевой ошибки fetch — только имя и код, без адреса с токеном. */
function networkReason(error: unknown): { reason: string; uncertain: boolean } {
  const e = error as { name?: string; cause?: { code?: unknown } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError")
    return { reason: "timeout", uncertain: true };
  const code = typeof e?.cause?.code === "string" ? e.cause.code : "";
  const safe = /^[A-Z_]{2,40}$/.test(code) ? code : "unknown";
  // До соединения (DNS, отказ, нет маршрута) запрос точно не ушёл.
  const notSent =
    /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT)$/.test(
      safe,
    );
  return { reason: `network ${safe}`, uncertain: !notSent };
}

/**
 * Доставка заявки сообщением в Telegram владельцу (Bot API sendMessage). На
 * сервере заявка не хранится. Ошибка доставки — исключение: пользователь видит
 * ошибку, а не «отправлено». Токен в журнал и в ошибку не попадает.
 */
export class TelegramRequestStore implements RequestStore {
  readonly mode = "live" as const;

  constructor(
    private readonly options: {
      token: string;
      chatId: string;
      /** Адрес Bot API (по умолчанию https://api.telegram.org) — для проверки на стенде. */
      apiBase?: string;
      fetch?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async save(record: RequestRecord): Promise<void> {
    const doFetch = this.options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(
        `${this.options.apiBase ?? "https://api.telegram.org"}/bot${this.options.token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.options.chatId,
            text: requestMessage(record),
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 25_000),
        },
      );
    } catch (error) {
      const { reason, uncertain } = networkReason(error);
      throw new DeliveryError(reason, uncertain);
    }
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
    } | null;
    if (response.ok && body?.ok === true) return;
    // Telegram ответил 200, но тело не прочитано — сообщение, скорее всего, ушло.
    if (response.ok && body === null)
      throw new DeliveryError("http 200, unreadable body", true);
    throw new DeliveryError(`http ${response.status}`, false);
  }
}

/**
 * Приём включается, только если настроена доставка (REQUESTS_TELEGRAM_BOT_TOKEN,
 * REQUESTS_TELEGRAM_CHAT_ID) и опубликована политика обработки персональных
 * данных (src/content/privacy.ts). Иначе — тестовый адаптер.
 */
export function requestStoreFromEnv(
  env: Record<string, string | undefined>,
  policyPublished: boolean,
): RequestStore {
  const token = env.REQUESTS_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.REQUESTS_TELEGRAM_CHAT_ID?.trim();
  const apiBase = env.REQUESTS_TELEGRAM_API?.trim() || undefined;
  return token && chatId && policyPublished
    ? new TelegramRequestStore({ token, chatId, apiBase })
    : new TestRequestStore();
}

let store: RequestStore | undefined;

/** Текущее хранилище (docs/requests.md). */
export function getRequestStore(): RequestStore {
  store ??= requestStoreFromEnv(process.env, privacyPolicy !== null);
  return store;
}
