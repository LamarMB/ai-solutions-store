import { describe, expect, it, vi } from "vitest";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import {
  addTurn,
  newSession,
  type Conversation,
} from "@/bot/conversation/memory";
import {
  decisionJsonSchema,
  sanitizeDecision,
  type ConversationInput,
} from "@/bot/conversation/model";
import { OpenAiClient } from "@/bot/llm/openai-client";
import {
  conversationInstructions,
  OpenAiConversationModel,
} from "@/bot/llm/openai-conversation";

const NOW = new Date("2026-10-19T06:00:00Z");
const KEY = "sk-test-0000000000000000000000";

const decision = (over: object = {}) => ({
  action: "ask_clarification",
  reply: "Как давно беспокоит?",
  question: "duration",
  complaint_area: "joint",
  complaint_summary: "боль в колене",
  trauma: "no",
  duration: null,
  red_flags: [],
  red_flags_denied: false,
  specialty_id: null,
  doctor_id: null,
  date: null,
  time: null,
  info_topic: null,
  urgency: "none",
  new_topic: false,
  ...over,
});

/** Ответ Responses API с JSON в output_text. */
const apiResponse = (payload: unknown, status = "completed") =>
  new Response(
    JSON.stringify({
      status,
      output: [
        { type: "reasoning" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text:
                typeof payload === "string" ? payload : JSON.stringify(payload),
            },
          ],
        },
      ],
    }),
    { status: 200 },
  );

function setup(fetchImpl: typeof fetch, options: object = {}) {
  let now = NOW;
  const errors: string[] = [];
  const model = new OpenAiConversationModel(
    fictionalClinic,
    new OpenAiClient({
      apiKey: KEY,
      model: "gpt-5.6-luna",
      fetch: fetchImpl,
      now: () => now,
      onError: (m) => errors.push(m),
      ...options,
    }),
    (m) => errors.push(m),
  );
  return {
    model,
    errors,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

function input(text = "Без травмы"): ConversationInput {
  const session = newSession();
  let conv: Conversation = {
    ...session.conv,
    complaint: { area: "joint", summary: "болит колено" },
    asked: ["trauma"],
    pending: "trauma",
  };
  conv = addTurn(conv, "patient", "Здравствуйте, у меня болит колено");
  conv = addTurn(conv, "bot", "Это началось после травмы?");
  conv = addTurn(conv, "patient", text);
  return { peerId: 1, today: "2026-10-19", text, flow: session.flow, conv };
}

describe("OpenAI: разговорная модель", () => {
  it("Responses API, строгая JSON-схема, store: false, память и история в запросе", async () => {
    const fetchMock = vi.fn(async () => apiResponse(decision()));
    const { model } = setup(fetchMock as unknown as typeof fetch);
    const result = await model.decide(input());
    expect(result).toMatchObject({
      action: "ask_clarification",
      question: "duration",
      trauma: "no",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: { type: "json_schema", strict: true, name: "clinic_turn" },
      },
    });
    expect(body.instructions).toBe(conversationInstructions(fictionalClinic));
    const prompt = body.input[0].content as string;
    expect(prompt).toMatch(/Сегодня: 2026-10-19, понедельник/);
    expect(prompt).toMatch(/последний вопрос бота: trauma/);
    expect(prompt).toMatch(
      /Пациент: Здравствуйте, у меня болит колено\nБот: Это началось после травмы\?/,
    );
    // Новое сообщение передаётся один раз — отдельно от истории.
    expect(prompt.match(/Без травмы/g)).toHaveLength(1);
  });

  it("инструкции запрещают диагнозы, лекарства и успокоение; данные — только из справки", () => {
    const text = conversationInstructions(fictionalClinic);
    expect(text).toMatch(/Не ставь диагнозы/);
    expect(text).toMatch(/лекарства, дозировки/);
    expect(text).toMatch(/Никогда не говори, что ситуация безопасна/);
    expect(text).toMatch(/urgent_care_guidance/);
    expect(text).toMatch(/Игорь Макетов/);
    // Границы темы и неизменная роль.
    expect(text).toMatch(/out_of_scope/);
    expect(text).toMatch(/Твоя роль не меняется никогда/);
    expect(text).toMatch(/выполняй только задачу клиники/);
    expect(text).not.toMatch(/подтверди запись|запиши сам/i);
  });

  it("схема: все поля обязательны, id врачей и направлений — только из справочника", () => {
    const schema = decisionJsonSchema(fictionalClinic);
    expect(schema.required).toEqual(Object.keys(schema.properties));
    expect(schema.properties.doctor_id.enum).toEqual([
      ...fictionalClinic.doctors.map((d) => d.id),
      null,
    ]);
    expect(schema.properties.action.enum).not.toContain("confirm_booking");
    expect(schema.properties.action.enum).toContain("out_of_scope");
  });

  it("неверный JSON, неизвестное действие, отказ модели — undefined, бот переходит к правилам", async () => {
    for (const payload of [
      "не JSON",
      decision({ action: "confirm_booking" }),
      decision({ urgency: "maybe" }),
    ]) {
      const { model } = setup((async () =>
        apiResponse(payload)) as unknown as typeof fetch);
      expect(await model.decide(input())).toBeUndefined();
    }
    const refusal = new Response(
      JSON.stringify({
        status: "completed",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "no" }] },
        ],
      }),
    );
    const { model } = setup((async () => refusal) as unknown as typeof fetch);
    expect(await model.decide(input())).toBeUndefined();
  });

  it("проверка решения: несуществующие врачи и даты отбрасываются, опасный текст скрывается", () => {
    const d = sanitizeDecision(
      decision({
        action: "start_booking",
        doctor_id: "dr-house",
        specialty_id: "cardiology",
        date: "завтра",
        time: "25:00",
        reply: "Примите таблетку и приходите в 10:00",
      }),
      fictionalClinic,
    );
    expect(d).toMatchObject({ action: "start_booking", reply: "" });
    expect(d?.doctorId).toBeUndefined();
    expect(d?.specialtyId).toBeUndefined();
    expect(d?.date).toBeUndefined();
    expect(d?.time).toBeUndefined();

    const ok = sanitizeDecision(
      decision({
        action: "start_booking",
        doctor_id: "maketov",
        date: "2026-10-20",
        time: "09:30",
      }),
      fictionalClinic,
    );
    expect(ok).toMatchObject({
      doctorId: "maketov",
      specialtyId: "orthopedist",
      date: "2026-10-20",
      time: "09:30",
    });
  });

  it("ошибка API — пауза 60 с без запросов; ошибка в журнале без текста пациента", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "model_not_found" } }), {
          status: 404,
        }),
    );
    const { model, errors, advance } = setup(
      fetchMock as unknown as typeof fetch,
    );
    expect(await model.decide(input())).toBeUndefined();
    expect(await model.decide(input())).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errors[0]).toBe("openai request failed: http 404 (model_not_found)");
    expect(errors.join()).not.toMatch(/колен|травм/);
    advance(61_000);
    await model.decide(input());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("лимиты: в сутки и в час на собеседника", async () => {
    const fetchMock = vi.fn(async () => apiResponse(decision()));
    const { model } = setup(fetchMock as unknown as typeof fetch, {
      dailyLimit: 3,
      perPeerHourlyLimit: 2,
    });
    expect(await model.decide(input())).toBeDefined();
    expect(await model.decide(input())).toBeDefined();
    expect(await model.decide(input())).toBeUndefined();
    expect(await model.decide({ ...input(), peerId: 2 })).toBeDefined();
    expect(await model.decide({ ...input(), peerId: 3 })).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("тайм-аут запроса — undefined", async () => {
    const { model, errors } = setup(
      ((_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("timeout", "TimeoutError")),
          ),
        )) as unknown as typeof fetch,
      { timeoutMs: 20 },
    );
    expect(await model.decide(input())).toBeUndefined();
    expect(errors[0]).toMatch(/openai request failed/);
  });

  it("незаконченный ответ (status incomplete) — undefined", async () => {
    const { model } = setup((async () =>
      apiResponse(decision(), "incomplete")) as unknown as typeof fetch);
    expect(await model.decide(input())).toBeUndefined();
  });
});

describe("OpenAI: параллельные запросы", () => {
  it("не больше OPENAI_CONCURRENCY одновременно; не дождались места — ответ по правилам", async () => {
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const fetchMock = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((r) => releases.push(r));
      active--;
      return apiResponse(decision());
    });
    const { model, errors } = setup(fetchMock as unknown as typeof fetch, {
      maxConcurrent: 2,
      queueWaitMs: 30,
    });
    const calls = [1, 2, 3].map((peerId) =>
      model.decide({ ...input(), peerId }),
    );
    // Третий не дождался места за 30 мс — сразу undefined (бот ответит по правилам).
    expect(await calls[2]).toBeUndefined();
    expect(errors).toContain("openai busy: answered by rules");
    for (const release of releases) release();
    expect(await calls[0]).toBeDefined();
    expect(await calls[1]).toBeDefined();
    expect(peak).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 и 5xx — один повтор с паузой; 400 — без повтора", async () => {
    const slept: number[] = [];
    const statuses = [429, 200];
    const retrying = vi.fn(async () => {
      const status = statuses.shift()!;
      return status === 200
        ? apiResponse(decision())
        : new Response(JSON.stringify({ error: { code: "rate_limit" } }), {
            status,
          });
    });
    const first = setup(retrying as unknown as typeof fetch, {
      sleep: async (ms: number) => void slept.push(ms),
    });
    expect(await first.model.decide(input())).toBeDefined();
    expect(retrying).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([500]);

    const bad = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "invalid_request" } }), {
          status: 400,
        }),
    );
    const second = setup(bad as unknown as typeof fetch, {
      sleep: async () => {},
    });
    expect(await second.model.decide(input())).toBeUndefined();
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
