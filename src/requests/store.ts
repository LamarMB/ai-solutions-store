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
      fetch?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async save(record: RequestRecord): Promise<void> {
    const doFetch = this.options.fetch ?? globalThis.fetch;
    const response = await doFetch(
      `https://api.telegram.org/bot${this.options.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.options.chatId,
          text: requestMessage(record),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean };
    if (!response.ok || body.ok !== true)
      throw new Error(`telegram delivery failed: http ${response.status}`);
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
  return token && chatId && policyPublished
    ? new TelegramRequestStore({ token, chatId })
    : new TestRequestStore();
}

let store: RequestStore | undefined;

/** Текущее хранилище (docs/requests.md). */
export function getRequestStore(): RequestStore {
  store ??= requestStoreFromEnv(process.env, privacyPolicy !== null);
  return store;
}
