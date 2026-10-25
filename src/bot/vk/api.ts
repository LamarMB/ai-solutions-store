/** Ошибка VK API с кодом. Сообщение — от ВКонтакте, без параметров запроса. */
export class VkApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly method: string,
  ) {
    super(`VK ${method}: ${code} ${message}`);
  }
}

/** Ошибки доступа: повторять бессмысленно, нужно исправить настройки. */
export const FATAL_VK_CODES = new Set([5, 15, 27, 28]);
/** Временные ошибки: слишком много запросов, внутренняя ошибка ВКонтакте. */
const RETRY_VK_CODES = new Set([6, 10]);

export type VkApiOptions = {
  token: string;
  version: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
};

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Минимальный клиент VK API: POST с токеном в теле (не в адресе — он не
 * попадает в логи прокси), повторы временных ошибок с паузой.
 */
export class VkApi {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: VkApiOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? sleep;
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const retries = this.options.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(method, params);
      } catch (error) {
        // Сетевые сбои и временные ошибки ВКонтакте повторяем, остальные — нет.
        const retryable =
          error instanceof VkApiError ? RETRY_VK_CODES.has(error.code) : true;
        if (!retryable || attempt >= retries) throw error;
        await this.sleep(500 * 2 ** attempt);
      }
    }
  }

  private async once<T>(
    method: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) body.set(key, String(value));
    }
    body.set("access_token", this.options.token);
    body.set("v", this.options.version);
    const response = await this.fetch(
      `${this.options.baseUrl ?? "https://api.vk.com/method"}/${method}`,
      {
        method: "POST",
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      },
    );
    if (!response.ok) throw new Error(`VK ${method}: http ${response.status}`);
    const json = (await response.json()) as {
      response?: T;
      error?: { error_code: number; error_msg: string };
    };
    if (json.error) {
      throw new VkApiError(json.error.error_code, json.error.error_msg, method);
    }
    return json.response as T;
  }
}
