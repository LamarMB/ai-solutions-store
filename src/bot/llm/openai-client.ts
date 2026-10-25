import { z } from "zod";

export type OpenAiClientOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  /** Максимум запросов к OpenAI в сутки на весь бот. */
  dailyLimit?: number;
  /** Максимум запросов в час от одного собеседника. */
  perPeerHourlyLimit?: number;
  /** После ошибки OpenAI не вызывается столько миллисекунд — работают правила. */
  cooldownMs?: number;
  /** Сообщения об ошибках без текста пациента и без ключа. */
  onError?: (message: string) => void;
};

/**
 * Рассуждающие модели (gpt-5…, o…) по умолчанию думают долго и дорого —
 * для ответа администратора хватает низкого уровня. Остальным параметр не передаётся.
 */
export function reasoningOptions(model: string) {
  return /^(gpt-5|o\d)/.test(model) ? { reasoning: { effort: "low" } } : {};
}

/** Ответ Responses API: текст из сообщения модели или отказ. */
const ResponseSchema = z.object({
  status: z.string().optional(),
  output: z
    .array(
      z.object({
        type: z.string(),
        content: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
              refusal: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
});

export type StructuredRequest = {
  instructions: string;
  input: string;
  schemaName: string;
  schema: object;
  maxOutputTokens?: number;
};

/**
 * Клиент OpenAI Responses API через fetch (без SDK) со Structured Outputs.
 * Лимиты запросов, тайм-аут и пауза после ошибки защищают бюджет; при любой
 * проблеме возвращается undefined — бот продолжает работать по правилам.
 */
export class OpenAiClient {
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private failedUntil = 0;
  private day = "";
  private dayCount = 0;
  private readonly peerCalls = new Map<number, number[]>();

  constructor(readonly options: OpenAiClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  get model(): string {
    return this.options.model;
  }

  async structured(
    peerId: number,
    request: StructuredRequest,
  ): Promise<unknown | undefined> {
    if (!this.allowCall(peerId)) return undefined;
    try {
      return await this.send(request);
    } catch (error) {
      this.failedUntil =
        this.now().getTime() + (this.options.cooldownMs ?? 60_000);
      this.options.onError?.(
        `openai request failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return undefined;
    }
  }

  private allowCall(peerId: number): boolean {
    const t = this.now().getTime();
    if (t < this.failedUntil) return false;
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.dayCount = 0;
    }
    if (this.dayCount >= (this.options.dailyLimit ?? 500)) return false;
    const recent = (this.peerCalls.get(peerId) ?? []).filter(
      (at) => t - at < 3_600_000,
    );
    if (recent.length >= (this.options.perPeerHourlyLimit ?? 30)) return false;
    recent.push(t);
    this.peerCalls.set(peerId, recent);
    this.dayCount += 1;
    return true;
  }

  private async send(request: StructuredRequest): Promise<unknown> {
    const response = await this.fetch(
      `${this.options.baseUrl ?? "https://api.openai.com/v1"}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          instructions: request.instructions,
          input: [{ role: "user", content: request.input }],
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName,
              strict: true,
              schema: request.schema,
            },
          },
          max_output_tokens: request.maxOutputTokens ?? 1500,
          ...reasoningOptions(this.options.model),
          // Не хранить запросы и ответы на стороне OpenAI.
          store: false,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      },
    );
    if (!response.ok) {
      // Код ошибки OpenAI (например, model_not_found) помогает настройке; текста запроса в нём нет.
      const error = (await response.json().catch(() => undefined)) as
        { error?: { code?: unknown } } | undefined;
      const code = error?.error?.code;
      throw new Error(
        `http ${response.status}${typeof code === "string" ? ` (${code.slice(0, 60)})` : ""}`,
      );
    }
    const body = ResponseSchema.safeParse(await response.json());
    if (!body.success) throw new Error("unexpected response shape");
    if (body.data.status && body.data.status !== "completed") {
      throw new Error(`status ${body.data.status}`);
    }
    const content = body.data.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? []);
    if (content.some((c) => c.type === "refusal")) throw new Error("refusal");
    const outputText = content.find((c) => c.type === "output_text")?.text;
    if (!outputText) throw new Error("empty output");
    try {
      return JSON.parse(outputText) as unknown;
    } catch {
      throw new Error("invalid json");
    }
  }
}
