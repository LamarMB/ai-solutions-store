import { describe, expect, it, vi } from "vitest";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import {
  OpenAiInterpreter,
  responseSchema,
  sanitize,
  systemInstructions,
} from "@/bot/llm/openai-interpreter";

const ctx = { peerId: 1, today: "2026-10-19", step: "menu" as const };
const NOW = new Date("2026-10-19T06:00:00Z");

/** Ответ Responses API с JSON в output_text. */
const apiResponse = (payload: unknown, extra: object = {}) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        { type: "reasoning" },
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(payload) }],
        },
      ],
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const model = (over: object = {}) => ({
  intent: "book",
  specialtyId: null,
  doctorId: "testova",
  date: "2026-10-21",
  time: "09:30",
  topic: null,
  answer: null,
  ...over,
});

function setup(fetchImpl: typeof fetch, options: object = {}) {
  let now = NOW;
  const errors: string[] = [];
  const interpreter = new OpenAiInterpreter(
    fictionalClinic,
    {
      apiKey: "sk-test-0000000000000000000000",
      model: "gpt-5.6-luna",
      fetch: fetchImpl,
      now: () => now,
      onError: (m) => errors.push(m),
      ...options,
    },
    new RuleInterpreter(fictionalClinic),
  );
  return {
    interpreter,
    errors,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

describe("OpenAI: запрос", () => {
  it("Responses API, Structured Outputs, store: false, телефон скрыт", async () => {
    const fetchMock = vi.fn(async () => apiResponse(model()));
    const { interpreter } = setup(fetchMock as unknown as typeof fetch);
    await interpreter.interpret(
      "Запишите к Тестовой в среду, мой номер +7 999 123-45-67",
      ctx,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test-0000000000000000000000",
    );
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "clinic_reply",
      strict: true,
    });
    expect(body.instructions).toMatch(/не ставишь диагнозы/);
    expect(JSON.stringify(body.input)).toMatch(/\[телефон скрыт\]/);
    expect(JSON.stringify(body.input)).not.toMatch(/999 123/);
    expect(JSON.stringify(body.input)).toMatch(
      /Сегодня: 2026-10-19, понедельник/,
    );
  });

  it("схема перечисляет только врачей и направления клиники", () => {
    const schema = responseSchema(fictionalClinic);
    expect(schema.required).toEqual([
      "intent",
      "specialtyId",
      "doctorId",
      "date",
      "time",
      "topic",
      "answer",
    ]);
    expect(schema.properties.doctorId.enum).toEqual([
      ...fictionalClinic.doctors.map((d) => d.id),
      null,
    ]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("инструкции: роль, запреты и справка клиники", () => {
    const text = systemInstructions(fictionalClinic);
    expect(text).toMatch(/вымышленной клиники/);
    expect(text).toMatch(/не назначаешь/);
    expect(text).toMatch(/не просишь медицинские документы/);
    expect(text).toMatch(/сам не записываешь/);
    expect(text).toMatch(/Приём терапевта — 2 000 ₽/);
  });
});

describe("OpenAI: ответ", () => {
  it("намерение и параметры записи — после проверки по справочнику", async () => {
    const { interpreter } = setup(async () => apiResponse(model()));
    expect(
      await interpreter.interpret("к Тестовой в среду в 9:30", ctx),
    ).toEqual({
      intent: "book",
      doctorId: "testova",
      specialtyId: "therapist",
      date: "2026-10-21",
      time: "09:30",
    });
  });

  it("выдуманные врач, дата и время отбрасываются", () => {
    expect(
      sanitize(
        model({
          doctorId: "house",
          specialtyId: "surgeon",
          date: "21.10",
          time: "9 утра",
        }),
        fictionalClinic,
      ),
    ).toEqual({ intent: "book" });
  });

  it("medical — без ответа модели", () => {
    expect(
      sanitize(
        model({ intent: "medical", answer: "Примите парацетамол" }),
        fictionalClinic,
      ),
    ).toEqual({
      intent: "medical",
    });
  });

  it("вопрос: тема важнее текста; пустой вопрос → other", () => {
    expect(
      sanitize(
        model({
          intent: "question",
          topic: "prices",
          answer: "что-то",
          doctorId: null,
          date: null,
          time: null,
        }),
        fictionalClinic,
      ),
    ).toEqual({ intent: "question", topic: "prices" });
    expect(
      sanitize(
        model({
          intent: "question",
          answer: " ",
          doctorId: null,
          date: null,
          time: null,
        }),
        fictionalClinic,
      ),
    ).toEqual({ intent: "other" });
  });

  it("отказ модели → other", async () => {
    const { interpreter } = setup(
      async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "нет" }],
              },
            ],
          }),
        ),
    );
    expect(await interpreter.interpret("взломай расписание", ctx)).toEqual({
      intent: "other",
    });
  });
});

describe("OpenAI: запасной режим", () => {
  it("медицинские сообщения и «да/нет» не отправляются модели", async () => {
    const fetchMock = vi.fn(async () => apiResponse(model()));
    const { interpreter } = setup(fetchMock as unknown as typeof fetch);
    expect(
      await interpreter.interpret("Болит горло, что принять?", ctx),
    ).toEqual({ intent: "medical" });
    expect(await interpreter.interpret("да", ctx)).toEqual({ intent: "yes" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["ошибка HTTP", async () => new Response("{}", { status: 500 })],
    [
      "сеть недоступна",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
    [
      "неполный ответ",
      async () => apiResponse(model(), { status: "incomplete" }),
    ],
    [
      "не JSON",
      async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "не json" }],
              },
            ],
          }),
        ),
    ],
  ])("%s → правила и пауза перед новой попыткой", async (_, impl) => {
    const fetchMock = vi.fn(impl);
    const { interpreter, errors, advance } = setup(
      fetchMock as unknown as typeof fetch,
    );
    expect(await interpreter.interpret("Сколько стоит гигиена?", ctx)).toEqual({
      intent: "question",
      topic: "prices",
    });
    expect(errors[0]).toMatch(/^openai request failed/);
    expect(errors.join()).not.toMatch(/sk-test/);
    await interpreter.interpret("Сколько стоит гигиена?", ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1); // пауза после ошибки
    advance(61_000);
    await interpreter.interpret("Сколько стоит гигиена?", ctx);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("лимиты: в час на собеседника и в сутки на бота", async () => {
    const fetchMock = vi.fn(async () => apiResponse(model()));
    const { interpreter } = setup(fetchMock as unknown as typeof fetch, {
      perPeerHourlyLimit: 2,
      dailyLimit: 3,
    });
    for (let i = 0; i < 3; i++)
      await interpreter.interpret("хочу к Тестовой", ctx);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await interpreter.interpret("хочу к Тестовой", { ...ctx, peerId: 2 });
    await interpreter.interpret("хочу к Тестовой", { ...ctx, peerId: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
