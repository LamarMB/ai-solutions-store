import { describe, expect, it } from "vitest";
import { createBot } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import {
  newSession,
  parseSession,
  serializeSession,
} from "@/bot/conversation/memory";
import {
  sanitizeDecision,
  type ConversationInput,
  type ConversationModel,
} from "@/bot/conversation/model";
import {
  EMERGENCY_TEXT,
  MEDICAL_ADVICE_REFUSAL,
} from "@/bot/conversation/safety";
import { OUT_OF_SCOPE_TEXT } from "@/bot/conversation/scope";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import type { Reply } from "@/bot/dialog/types";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";

// Понедельник, 19 октября 2026, 09:00 по Москве.
const START = new Date("2026-10-19T06:00:00Z");
const PEER = 9;

const raw = (over: Record<string, unknown> = {}) => ({
  action: "ask_clarification",
  reply: "Расскажите, пожалуйста, подробнее.",
  question: null,
  complaint_area: null,
  complaint_summary: null,
  trauma: null,
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

/** Мок GPT: считает обращения и отвечает как осторожная модель. */
class CountingModel implements ConversationModel {
  readonly calls: ConversationInput[] = [];
  async decide(input: ConversationInput) {
    this.calls.push(structuredClone(input));
    const answer = /айфон/i.test(input.text)
      ? raw({ action: "out_of_scope", reply: "" })
      : /колен/i.test(input.text)
        ? raw({
            action: "ask_clarification",
            question: "trauma",
            complaint_area: "joint",
            complaint_summary: "боль в колене",
            reply: "Это началось после травмы или без видимой причины?",
          })
        : raw();
    return sanitizeDecision(answer, fictionalClinic);
  }
}

function setup(withModel = true) {
  const model = withModel ? new CountingModel() : undefined;
  const store = new SqliteStore(":memory:");
  store.save(PEER, serializeSession(newSession()), START.toISOString());
  const schedule = new ClinicSchedule(fictionalClinic, store, () => START);
  const bot = createBot({
    clinic: fictionalClinic,
    schedule,
    sessions: store,
    interpreter: new RuleInterpreter(fictionalClinic),
    model,
    stats: store,
    now: () => START,
  });
  return {
    model,
    store,
    schedule,
    say: (text: string) => bot.handle(PEER, { type: "text", text }),
    press: async (last: Reply[], label: string) => {
      const button = last
        .flatMap((r) => r.buttons.flat())
        .find((b) => b.label === label);
      if (!button) throw new Error(`Нет кнопки «${label}»`);
      return bot.handle(PEER, { type: "action", payload: button.action });
    },
    flow: () => parseSession(store.load(PEER)?.state).flow,
    stats: () =>
      Object.fromEntries(
        store.readStats("2026-01-01").map((r) => [r.key, r.count]),
      ),
  };
}
const text = (replies: Reply[]) => replies.map((r) => r.text).join("\n");

describe("простые однозначные просьбы — правилами, без OpenAI", () => {
  const cases: [string, (t: ReturnType<typeof setup>, r: Reply[]) => void][] = [
    ["меню", (t) => expect(t.flow()).toEqual({ step: "menu" })],
    ["покажите мои записи", (t) => expect(t.flow().step).toBe("bookings")],
    ["хочу отменить запись", (t) => expect(t.flow().step).toBe("bookings")],
    ["позовите администратора", (t) => expect(t.flow().step).toBe("handoff")],
    ["где вы находитесь?", (_, r) => expect(text(r)).toMatch(/Вымышленная/)],
    ["адрес клиники", (_, r) => expect(text(r)).toMatch(/Вымышленная/)],
    ["сколько стоит приём терапевта?", (_, r) => expect(text(r)).toMatch(/₽/)],
    ["какие врачи есть?", (_, r) => expect(text(r)).toMatch(/Анна Тестова/)],
    ["как добраться?", (_, r) => expect(text(r).length).toBeGreaterThan(20)],
    [
      "как подготовиться к приёму?",
      (_, r) => expect(text(r).length).toBeGreaterThan(20),
    ],
    ["хочу записаться", (t) => expect(t.flow().step).toBe("specialty")],
    [
      "запишите к стоматологу",
      (t) => expect(t.flow()).toMatchObject({ specialtyId: "dentist" }),
    ],
    [
      "хочу к лору",
      (t) => expect(t.flow()).toMatchObject({ specialtyId: "ent" }),
    ],
    [
      "к Анне Тестовой",
      (t) => expect(t.flow()).toMatchObject({ doctorId: "testova" }),
    ],
  ];
  for (const [message, check] of cases)
    it(`«${message}»`, async () => {
      const t = setup();
      const r = await t.say(message);
      expect(t.model!.calls).toHaveLength(0);
      check(t, r);
      expect(t.stats()).toMatchObject({
        simple_rules: 1,
        model_requests_saved: 1,
      });
      expect(t.schedule.listBookings(PEER)).toHaveLength(0);
    });
});

describe("в модель, как раньше: жалобы, медицина, неоднозначность, разговор", () => {
  const toModel = [
    "болит колено",
    "хочу к терапевту болит горло",
    "что выпить от головной боли?",
    "сколько стоит новый айфон?",
    "подскажите про приём терапевта",
    "где вы находитесь и сколько стоит лор",
    "запишите к терапевту, пожалуйста, мне срочно",
    "запишите к терапевту на завтра",
    "хочу к терапевту в пятницу утром",
    "ок",
    "да",
    "нет",
    "мне бы к хорошему специалисту по суставам",
  ];
  for (const message of toModel)
    it(`«${message}» — модель`, async () => {
      const t = setup();
      await t.say(message);
      expect(t.model!.calls).toHaveLength(1);
      expect(t.stats()).not.toHaveProperty("simple_rules");
    });

  it("посторонний вопрос со словом «стоит» отклоняет модель, а не правила", async () => {
    const t = setup();
    expect(text(await t.say("Сколько стоит новый айфон?"))).toBe(
      OUT_OF_SCOPE_TEXT,
    );
  });

  it("незавершённый разговор о жалобе: даже простая по виду фраза — в модель", async () => {
    const t = setup();
    await t.say("болит колено");
    expect(t.model!.calls).toHaveLength(1);
    await t.say("какие врачи есть?");
    expect(t.model!.calls).toHaveLength(2);
  });

  it("посреди записи (не шаг меню) — в модель", async () => {
    const t = setup();
    await t.say("хочу к лору");
    expect(t.flow().step).not.toBe("menu");
    await t.say("какие врачи есть?");
    expect(t.model!.calls).toHaveLength(1);
  });
});

describe("безопасность не меняется", () => {
  it("тревожные признаки — 103/112 до правил и модели", async () => {
    const t = setup();
    expect(text(await t.say("сильно болит в груди"))).toContain(
      EMERGENCY_TEXT.slice(0, 40),
    );
    expect(t.model!.calls).toHaveLength(0);
    expect(t.stats()).not.toHaveProperty("simple_rules");
  });

  it("после экстренного сообщения простая фраза — в модель", async () => {
    const t = setup();
    await t.say("сильно болит в груди");
    await t.say("адрес клиники");
    expect(t.stats()).not.toHaveProperty("simple_rules");
  });

  it("просьба о лекарстве в коротком сообщении — отказ, не справка", async () => {
    const t = setup();
    const r = await t.say("какие таблетки можно?");
    expect(t.stats()).not.toHaveProperty("simple_rules");
    expect(text(r)).toContain(MEDICAL_ADVICE_REFUSAL.slice(0, 30));
  });

  it("без модели в настройках поведение прежнее (только правила)", async () => {
    const t = setup(false);
    await t.say("хочу к лору");
    expect(t.flow()).toMatchObject({ specialtyId: "ent" });
    expect(t.stats()).not.toHaveProperty("simple_rules");
    expect(t.stats()).not.toHaveProperty("model_requests_saved");
  });
});

describe("сквозная запись простыми сообщениями", () => {
  it("«ближайшее время к терапевту» → подтверждение кнопкой → запись; без OpenAI", async () => {
    const t = setup();
    const r = await t.say("ближайшее время к терапевту");
    expect(t.flow().step).toBe("confirm");
    // Без подтверждения записи нет.
    expect(t.schedule.listBookings(PEER)).toHaveLength(0);
    await t.press(r, "Подтвердить");
    const bookings = t.schedule.listBookings(PEER);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({ doctorId: "testova" });
    expect(t.model!.calls).toHaveLength(0);
  });

  it("«хочу записаться» → направление → врач → день → время → «да»", async () => {
    const t = setup();
    let r = await t.say("хочу записаться");
    r = await t.press(r, "Стоматолог");
    // Врач (если их несколько) → день → время: первые предложенные кнопки.
    for (const a of ["doc", "day", "time"]) {
      const button = r
        .flatMap((x) => x.buttons.flat())
        .find((b) => b.action.a === a);
      if (button) r = await t.press(r, button.label);
    }
    expect(t.flow().step).toBe("confirm");
    expect(t.schedule.listBookings(PEER)).toHaveLength(0);
    await t.say("да");
    expect(t.schedule.listBookings(PEER)).toHaveLength(1);
    expect(t.model!.calls).toHaveLength(0);
  });
});
