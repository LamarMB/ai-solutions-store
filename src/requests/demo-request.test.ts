import { describe, expect, it } from "vitest";
import { getSolutions } from "@/catalog";
import {
  createIdempotencyCache,
  createRateLimiter,
} from "@/requests/rate-limit";
import { DemoRequestSchema, formDataToInput } from "@/requests/schema";
import { handleSubmission, type SubmitDeps } from "@/requests/service";
import type { SubmitState } from "@/requests/state";
import {
  DeliveryError,
  requestMessage,
  requestStoreFromEnv,
  TelegramRequestStore,
  TestRequestStore,
  type RequestRecord,
  type RequestStore,
} from "@/requests/store";

const NOW = 1_800_000_000_000;
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "123456:secret-token-value";

function demoForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const fields: Record<string, string> = {
    form: "demo",
    name: "Анна",
    company: "Клиника «Пример»",
    contactMethod: "telegram",
    contact: "@Clinic_Admin",
    consent: "on",
    solutionId: "clinic-ai-administrator",
    website: "",
    startedAt: String(NOW - 10_000),
    submissionId: UUID,
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function deps(store: RequestStore, logs: string[] = []): SubmitDeps {
  return {
    store,
    limiter: createRateLimiter({ limit: 3, windowMs: 60_000, now: () => NOW }),
    idempotency: createIdempotencyCache<SubmitState>({
      ttlMs: 60_000,
      now: () => NOW,
    }),
    solutions: getSolutions(),
    clientKey: "client-a",
    now: () => NOW,
    newId: () => "req-1",
    log: (m) => logs.push(m),
  };
}

/** Telegram Bot API: запоминает запросы, отвечает как настроено. */
function fakeTelegram(reply: { status: number; body: unknown }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json(reply.body, { status: reply.status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("короткая заявка на демонстрацию — схема", () => {
  const parse = (o: Record<string, string>) =>
    DemoRequestSchema.safeParse(formDataToInput(demoForm(o)));

  it("имя, клиника, способ связи и согласие; описание задачи не нужно", () => {
    const r = parse({});
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      company: "Клиника «Пример»",
      contactMethod: "telegram",
      contact: "@clinic_admin",
      message: "",
    });
  });

  it("без клиники, контакта или согласия — ошибки по полям", () => {
    const r = parse({ company: "", contact: "", consent: "" });
    expect(r.success).toBe(false);
    const fields = r.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(
      expect.arrayContaining(["company", "contact", "consent"]),
    );
  });

  it("контакт проверяется по способу связи", () => {
    expect(parse({ contact: "ab" }).success).toBe(false);
    expect(
      parse({ contactMethod: "phone", contact: "+7 (900) 123-45-67" }).data
        ?.contact,
    ).toBe("+79001234567");
    expect(parse({ contactMethod: "phone", contact: "123" }).success).toBe(
      false,
    );
    expect(parse({ contactMethod: "email", contact: "nope" }).success).toBe(
      false,
    );
  });
});

describe("доставка заявки в Telegram", () => {
  const record: RequestRecord = {
    id: "req-1",
    createdAt: new Date(NOW).toISOString(),
    items: [{ solutionId: "clinic-ai-administrator", packageId: null }],
    contact: {
      name: "Анна",
      company: "Клиника",
      method: "telegram",
      value: "@clinic_admin",
    },
    message: "",
    source: "главная страница, «Получить демонстрацию»",
  };

  it("текст без разметки, со всеми полями и отметкой о согласии", async () => {
    const tg = fakeTelegram({ status: 200, body: { ok: true } });
    const store = new TelegramRequestStore({
      token: TOKEN,
      chatId: "42",
      fetch: tg.fetch,
    });
    await store.save(record);
    expect(tg.calls).toHaveLength(1);
    expect(tg.calls[0].url).toBe(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    );
    expect(tg.calls[0].body).toMatchObject({ chat_id: "42" });
    expect(tg.calls[0].body).not.toHaveProperty("parse_mode");
    const text = String(tg.calls[0].body.text);
    expect(text).toMatch(/Источник: главная страница/);
    expect(text).toMatch(/Имя: Анна/);
    expect(text).toMatch(/Клиника: Клиника/);
    expect(text).toMatch(/Связь \(Telegram\): @clinic_admin/);
    expect(text).toMatch(/Согласие на обработку персональных данных получено/);
    expect(requestMessage(record)).toBe(text);
  });

  it("ошибка Telegram — исключение без токена в тексте ошибки", async () => {
    for (const reply of [
      { status: 401, body: { ok: false } },
      { status: 200, body: { ok: false } },
    ]) {
      const store = new TelegramRequestStore({
        token: TOKEN,
        chatId: "42",
        fetch: fakeTelegram(reply).fetch,
      });
      const error = await store.save(record).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("secret");
    }
  });

  it("включается только с токеном, чатом и опубликованной политикой", () => {
    const env = {
      REQUESTS_TELEGRAM_BOT_TOKEN: TOKEN,
      REQUESTS_TELEGRAM_CHAT_ID: "42",
    };
    expect(requestStoreFromEnv(env, true).mode).toBe("live");
    expect(requestStoreFromEnv(env, false)).toBeInstanceOf(TestRequestStore);
    expect(
      requestStoreFromEnv({ ...env, REQUESTS_TELEGRAM_CHAT_ID: "" }, true).mode,
    ).toBe("test");
    expect(requestStoreFromEnv({}, true).mode).toBe("test");
  });
});

describe("обработка короткой заявки", () => {
  it("доставлено — «принято» в режиме live; в журнале только номер", async () => {
    const tg = fakeTelegram({ status: 200, body: { ok: true } });
    const logs: string[] = [];
    const state = await handleSubmission(
      demoForm(),
      deps(
        new TelegramRequestStore({
          token: TOKEN,
          chatId: "42",
          fetch: tg.fetch,
        }),
        logs,
      ),
    );
    expect(state).toEqual({
      status: "accepted",
      mode: "live",
      reference: "req-1",
    });
    expect(tg.calls).toHaveLength(1);
    expect(logs.join(" ")).not.toMatch(/Анна|clinic_admin|Пример|secret/);
  });

  it("сбой доставки — ошибка, а не ложное «отправлено»", async () => {
    const tg = fakeTelegram({ status: 502, body: {} });
    const state = await handleSubmission(
      demoForm(),
      deps(
        new TelegramRequestStore({
          token: TOKEN,
          chatId: "42",
          fetch: tg.fetch,
        }),
      ),
    );
    expect(state.status).toBe("error");
  });

  it("ловушка для ботов и слишком быстрая отправка — в Telegram ничего не уходит", async () => {
    const tg = fakeTelegram({ status: 200, body: { ok: true } });
    const store = new TelegramRequestStore({
      token: TOKEN,
      chatId: "42",
      fetch: tg.fetch,
    });
    await handleSubmission(demoForm({ website: "spam" }), deps(store));
    const fast = await handleSubmission(
      demoForm({
        startedAt: String(NOW - 500),
        submissionId: "223e4567-e89b-42d3-a456-426614174000",
      }),
      deps(store),
    );
    expect(fast.status).toBe("too_fast");
    expect(tg.calls).toHaveLength(0);
  });

  it("повтор той же отправки — без второй заявки", async () => {
    const tg = fakeTelegram({ status: 200, body: { ok: true } });
    const d = deps(
      new TelegramRequestStore({ token: TOKEN, chatId: "42", fetch: tg.fetch }),
    );
    await handleSubmission(demoForm(), d);
    await handleSubmission(demoForm(), d);
    expect(tg.calls).toHaveLength(1);
  });

  it("без согласия — ошибка поля, ничего не отправляется", async () => {
    const tg = fakeTelegram({ status: 200, body: { ok: true } });
    const state = await handleSubmission(
      demoForm({ consent: "" }),
      deps(
        new TelegramRequestStore({
          token: TOKEN,
          chatId: "42",
          fetch: tg.fetch,
        }),
      ),
    );
    expect(state.status).toBe("invalid");
    expect(tg.calls).toHaveLength(0);
  });
});

describe("ответ Telegram не получен", () => {
  /** fetch, который отправил запрос и упал с заданной ошибкой. */
  function failingFetch(error: unknown) {
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      throw error;
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls: () => calls };
  }
  const timeout = new DOMException("The operation timed out.", "TimeoutError");
  const refused = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "ECONNREFUSED" },
  });
  const reset = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "ECONNRESET", message: `api.telegram.org/bot${TOKEN}` },
  });

  it("тайм-аут — «отправлена, подтверждение не пришло», а не «не удалось»; повтор не шлёт вторую", async () => {
    const f = failingFetch(timeout);
    const logs: string[] = [];
    const d = deps(
      new TelegramRequestStore({ token: TOKEN, chatId: "42", fetch: f.fetch }),
      logs,
    );
    const state = await handleSubmission(demoForm(), d);
    expect(state).toMatchObject({ status: "uncertain", reference: "req-1" });
    expect("message" in state && state.message).toMatch(
      /повторно отправлять не нужно/,
    );
    await handleSubmission(demoForm(), d);
    expect(f.calls()).toBe(1);
    expect(logs.join(" ")).toMatch(
      /save failed id=req-1 mode=live reason=timeout/,
    );
  });

  it("обрыв после отправки — тоже «не подтверждено»; токена в журнале нет", async () => {
    const logs: string[] = [];
    const state = await handleSubmission(
      demoForm(),
      deps(
        new TelegramRequestStore({
          token: TOKEN,
          chatId: "42",
          fetch: failingFetch(reset).fetch,
        }),
        logs,
      ),
    );
    expect(state.status).toBe("uncertain");
    expect(logs.join(" ")).toMatch(/reason=network ECONNRESET/);
    expect(logs.join(" ")).not.toMatch(/secret|telegram\.org|Анна/);
  });

  it("соединение не установлено — запрос не ушёл: обычная ошибка, можно повторить", async () => {
    const f = failingFetch(refused);
    const d = deps(
      new TelegramRequestStore({ token: TOKEN, chatId: "42", fetch: f.fetch }),
    );
    expect((await handleSubmission(demoForm(), d)).status).toBe("error");
    await handleSubmission(demoForm(), d);
    expect(f.calls()).toBe(2);
  });

  it("200 с нечитаемым телом — не подтверждено; 502 — ошибка", async () => {
    const unreadable = (async () =>
      new Response("<html>", {
        status: 200,
      })) as unknown as typeof globalThis.fetch;
    const store = new TelegramRequestStore({
      token: TOKEN,
      chatId: "42",
      fetch: unreadable,
    });
    const error = await store
      .save({
        id: "x",
        createdAt: "",
        items: [],
        contact: { name: "a", method: "telegram", value: "@a" },
        message: "",
        source: "",
      })
      .catch((e: DeliveryError) => e);
    expect(error).toBeInstanceOf(DeliveryError);
    expect((error as DeliveryError).uncertain).toBe(true);
  });
});
