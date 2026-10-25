import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBot } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { parseSession } from "@/bot/conversation/memory";
import {
  sanitizeDecision,
  type ConversationInput,
  type ConversationModel,
} from "@/bot/conversation/model";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import type { Reply } from "@/bot/dialog/types";
import { OpenAiClient } from "@/bot/llm/openai-client";
import { OpenAiConversationModel } from "@/bot/llm/openai-conversation";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const PEER = 7;

/** Полный ответ модели по схеме; в тестах меняются только нужные поля. */
const raw = (over: Record<string, unknown> = {}) => ({
  action: "small_talk",
  reply: "",
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

/**
 * Мок GPT: ответ по тексту сообщения. Ответ проходит ту же проверку, что и
 * ответ настоящей модели (sanitizeDecision). Токены API не тратятся.
 */
class ScriptedModel implements ConversationModel {
  readonly calls: ConversationInput[] = [];
  constructor(private readonly script: (input: ConversationInput) => unknown) {}
  async decide(input: ConversationInput) {
    this.calls.push(structuredClone(input));
    const answer = this.script(input);
    return answer === undefined
      ? undefined
      : sanitizeDecision(answer, fictionalClinic);
  }
}

function setup({
  model,
  store = new SqliteStore(":memory:"),
}: { model?: ConversationModel; store?: SqliteStore } = {}) {
  const now = () => NOW;
  const schedule = new ClinicSchedule(fictionalClinic, store, now);
  const bot = createBot({
    clinic: fictionalClinic,
    schedule,
    sessions: store,
    interpreter: new RuleInterpreter(fictionalClinic),
    model,
    now,
  });
  const say = (text: string) => bot.handle(PEER, { type: "text", text });
  const press = async (last: Reply[], label: string) => {
    const button = last
      .flatMap((r) => r.buttons.flat())
      .find((b) => b.label === label);
    if (!button)
      throw new Error(
        `Нет кнопки «${label}»: ${last
          .flatMap((r) => r.buttons.flat())
          .map((b) => b.label)
          .join(", ")}`,
      );
    return bot.handle(PEER, { type: "action", payload: button.action });
  };
  const memory = () => parseSession(store.load(PEER)?.state).conv;
  const flow = () => parseSession(store.load(PEER)?.state).flow;
  return { bot, schedule, store, say, press, memory, flow };
}

const text = (replies: Reply[]) => replies.map((r) => r.text).join("\n");
const labels = (replies: Reply[]) =>
  replies.flatMap((r) => r.buttons.flat()).map((b) => b.label);

/** Мок GPT для сценария с коленом из постановки задачи. */
const kneeModel = () =>
  new ScriptedModel(({ text: t }) => {
    if (/колено/i.test(t) && /болит/i.test(t))
      return raw({
        action: "ask_clarification",
        question: "trauma",
        complaint_area: "joint",
        complaint_summary: "боль в колене",
        reply:
          "Здравствуйте! Помогу подобрать специалиста. Подскажите, боль появилась после травмы или без видимой причины?",
      });
    if (/без травмы/i.test(t))
      return raw({
        action: "ask_clarification",
        question: "duration",
        trauma: "no",
        reply: "Понял. А как давно беспокоит колено?",
      });
    if (/четыре/i.test(t))
      return raw({
        action: "ask_clarification",
        question: "red_flags",
        duration: "4 дня",
        reply:
          "Спасибо. Есть ли сильный отёк, заметная деформация или настолько сильная боль, что трудно наступать на ногу?",
      });
    if (/ноет/i.test(t))
      return raw({
        action: "suggest_specialty",
        specialty_id: "orthopedist",
        red_flags_denied: true,
        reply:
          "Понял вас. Могу предложить запись к травматологу-ортопеду для очной оценки. Давайте посмотрим свободное время.",
      });
    if (/ближайш/i.test(t))
      return raw({ action: "nearest_slot", specialty_id: "orthopedist" });
    return raw();
  });

describe("1. колено без травмы: уточнения → специалист → запись", () => {
  it("с GPT: вопросы по одному, память фактов, запись без меню", async () => {
    const model = kneeModel();
    const t = setup({ model });
    let r = await t.say("Здравствуйте, у меня болит колено");
    expect(text(r)).toMatch(/после травмы или без видимой причины/);
    expect(labels(r)).toContain("Без травмы");

    r = await t.say("Без травмы");
    expect(text(r)).toMatch(/как давно беспокоит/);
    r = await t.say("Уже дня четыре");
    expect(text(r)).toMatch(/сильный отёк, заметная деформация/);
    // Модель видит, что уже известно, и какой вопрос задан последним.
    expect(model.calls[2].conv).toMatchObject({
      trauma: "no",
      asked: ["trauma", "duration"],
      pending: "duration",
    });

    r = await t.say("Нет, просто иногда ноет");
    expect(text(r)).toMatch(/травматологу-ортопеду для очной оценки/);
    expect(text(r)).toMatch(
      /Игорь Макетов — ближайшее время: пн, 19 окт, 14:00/,
    );
    expect(t.memory()).toMatchObject({
      complaint: { area: "joint" },
      trauma: "no",
      duration: "дня четыре",
      redFlagsDenied: true,
      specialtyId: "orthopedist",
    });

    r = await t.say("Запишите на ближайшее время");
    expect(text(r)).toMatch(/Проверьте запись/);
    expect(text(r)).toMatch(/Игорь Макетов/);
    expect(t.schedule.listBookings(PEER)).toHaveLength(0);

    r = await t.press(r, "Подтвердить");
    expect(text(r)).toMatch(/подтверждена/);
    expect(t.schedule.listBookings(PEER)).toMatchObject([
      { doctorId: "maketov", date: "2026-10-19", time: "14:00" },
    ]);
    // После записи жалоба забывается.
    expect(t.memory().complaint).toBeUndefined();
  });

  it("без GPT тот же сценарий проходит по правилам", async () => {
    const t = setup();
    let r = await t.say("Здравствуйте, у меня болит колено");
    expect(text(r)).toMatch(/после травмы/);
    r = await t.say("Без травмы");
    expect(text(r)).toMatch(/Как давно/);
    r = await t.say("Уже дня четыре");
    expect(text(r)).toMatch(/сильный отёк, заметная деформация/);
    r = await t.say("Нет, просто иногда ноет");
    expect(text(r)).toMatch(/к травматологу-ортопеду/);
    r = await t.press(r, "Ближайшее время");
    r = await t.say("да");
    expect(text(r)).toMatch(/подтверждена/);
    expect(t.schedule.listBookings(PEER)).toHaveLength(1);
  });

  it("кнопки ответов работают так же, как текст", async () => {
    const t = setup();
    let r = await t.say("болит колено");
    r = await t.press(r, "Без травмы");
    expect(text(r)).toMatch(/Как давно/);
    r = await t.say("неделю");
    r = await t.press(r, "Нет, такого нет");
    expect(text(r)).toMatch(/травматологу-ортопеду/);
  });
});

describe("1b. запись из разговора без кнопочного меню (правила)", () => {
  it("«Запишите на ближайшее время» и «да» после предложения", async () => {
    const t = setup();
    await t.say("болит колено, без травмы, уже неделю");
    let r = await t.say("нет");
    expect(text(r)).toMatch(/Давайте посмотрим свободное время/);
    r = await t.say("да");
    expect(text(r)).toMatch(
      /Нашёл ближайшее свободное время[\s\S]*Игорь Макетов/,
    );
    r = await t.say("назад");
    r = await t.say("Запишите на ближайшее время");
    expect(text(r)).toMatch(/Проверьте запись[\s\S]*пн, 19 окт, 14:00/);
    r = await t.say("подтверждаю");
    expect(t.schedule.listBookings(PEER)).toHaveLength(1);
  });

  it("«просто запишите» во время расспросов — сразу подходящий специалист", async () => {
    const t = setup();
    await t.say("болит колено");
    const r = await t.say("давайте просто запишемся");
    expect(text(r)).toMatch(/травматологу-ортопеду/);
    expect(t.memory().pending).toBeUndefined();
  });
});

describe("2–5. срочность", () => {
  it("2. травма без экстренных признаков — обратиться пораньше, ближайшие слоты", async () => {
    const t = setup();
    let r = await t.say("Подвернул ногу вчера, болит лодыжка");
    expect(text(r)).toMatch(/сильный отёк, заметная деформация/);
    r = await t.say("Нет, отёка нет, наступать могу");
    expect(text(r)).toMatch(/как можно раньше/);
    expect(text(r)).toMatch(/ближайшее время/);
    expect(labels(r)).toContain("Ближайшее время");
  });

  it("3. травма и невозможность наступить — сразу 103/112, без записи и без модели", async () => {
    const model = new ScriptedModel(() =>
      raw({ action: "suggest_specialty", specialty_id: "orthopedist" }),
    );
    const t = setup({ model });
    const r = await t.say(
      "после падения, колено сильно опухло, не могу наступить",
    );
    expect(text(r)).toMatch(/103/);
    expect(text(r)).toMatch(/112/);
    expect(text(r)).not.toMatch(/Выберите врача|ближайшее время/);
    expect(labels(r)).not.toContain("Ближайшее время");
    // Правило сработало до модели: её ответ не мог отменить срочность.
    expect(model.calls).toHaveLength(0);
    expect(t.memory().urgency).toBe("emergency");
  });

  it("3a. модель не может понизить срочность сработавшего правила", async () => {
    const model = new ScriptedModel(() =>
      raw({
        action: "suggest_specialty",
        specialty_id: "orthopedist",
        urgency: "none",
      }),
    );
    const t = setup({ model });
    await t.say("болит колено");
    const r = await t.say("упал, нога неестественно согнута");
    expect(text(r)).toMatch(/103/);
  });

  it("3b. после экстренного ответа бот сам запись не предлагает", async () => {
    const t = setup();
    await t.say("упал, колено сильно опухло, не могу наступить");
    const r = await t.say("что выпить от боли?");
    expect(text(r)).toMatch(/не ставлю диагнозы/);
    expect(text(r)).toMatch(/сначала обратитесь за срочной помощью/);
    expect(labels(r)).not.toContain("Ближайшее время");
  });

  it("4. без травмы, но с тревожным признаком — срочная помощь", async () => {
    const t = setup();
    await t.say("болит колено, травмы не было");
    const r = await t.say("и сейчас внезапно онемела нога");
    expect(text(r)).toMatch(/103/);
  });

  it("4a. «да» на вопрос о тревожных признаках — срочная помощь", async () => {
    const t = setup();
    await t.say("болит колено, травмы не было, уже неделю");
    const r = await t.say("да");
    expect(text(r)).toMatch(/103/);
  });

  it("4b. модель может повысить срочность, и она не понижается следующей репликой", async () => {
    const answers = [
      raw({ action: "urgent_care_guidance", urgency: "emergency" }),
      raw({
        action: "suggest_specialty",
        specialty_id: "therapist",
        urgency: "none",
      }),
    ];
    const model = new ScriptedModel(() => answers.shift());
    const t = setup({ model });
    const r = await t.say("мне очень плохо, всё плывёт");
    expect(text(r)).toMatch(/103/);
    const next = await t.say("ну может просто к терапевту?");
    expect(t.memory().urgency).toBe("emergency");
    expect(text(next)).toMatch(/сначала обратитесь за срочной помощью/);
  });

  it("5. «отёка нет» не считается сильным отёком", async () => {
    const t = setup();
    const r = await t.say(
      "Болит колено после удара, отёка нет, деформации нет",
    );
    expect(text(r)).not.toMatch(/103/);
    expect(t.memory().redFlags).toEqual([]);
    expect(t.memory().trauma).toBe("yes");
  });
});

describe("6. не переспрашивает известное", () => {
  it("правила: «три дня, травмы не было» → сразу вопрос о признаках", async () => {
    const t = setup();
    const r = await t.say("Болит колено три дня, травмы не было");
    expect(text(r)).toMatch(/сильный отёк/);
    expect(text(r)).not.toMatch(/после травмы|Как давно/);
  });

  it("модель пытается спросить о травме повторно — бот задаёт следующий вопрос", async () => {
    const model = new ScriptedModel(() =>
      raw({
        action: "ask_clarification",
        question: "trauma",
        complaint_area: "joint",
        reply: "Скажите, была ли травма?",
      }),
    );
    const t = setup({ model });
    const r = await t.say("Болит колено три дня, травмы не было");
    expect(text(r)).not.toMatch(/была ли травма/);
    expect(text(r)).toMatch(/сильный отёк/);
  });

  it("короткие ответы относятся к последнему вопросу", async () => {
    const t = setup();
    await t.say("Болит колено");
    const r = await t.say("Три дня");
    // Вопрос о травме пациент пропустил: длительность запомнена, о травме
    // бот не спрашивает второй раз, а переходит к следующему вопросу.
    expect(t.memory()).toMatchObject({
      duration: "три дня",
      pending: "red_flags",
    });
    expect(text(r)).toMatch(/сильный отёк/);
  });
});

describe("7–8. смена темы и вопросы посреди записи", () => {
  it("7. с жалобы на колено — на запись к стоматологу", async () => {
    const t = setup();
    await t.say("болит колено");
    const r = await t.say("Хотя нет, запишите лучше к стоматологу");
    expect(text(r)).toMatch(/Мария Демонстрова/);
    expect(t.memory().complaint).toBeUndefined();
  });

  it("7a. с GPT: new_topic сбрасывает прежнюю жалобу", async () => {
    const model = new ScriptedModel(({ text: t }) =>
      /стоматолог/.test(t)
        ? raw({
            action: "list_available_slots",
            specialty_id: "dentist",
            new_topic: true,
            reply: "Конечно, давайте посмотрим время у стоматолога.",
          })
        : raw({
            action: "ask_clarification",
            question: "trauma",
            complaint_area: "joint",
            reply: "Была ли травма?",
          }),
    );
    const t = setup({ model });
    await t.say("болит колено");
    const r = await t.say("А вообще мне к стоматологу надо");
    expect(text(r)).toMatch(/время у стоматолога/);
    expect(text(r)).toMatch(/Мария Демонстрова\. Выберите день/);
    expect(t.memory().complaint).toBeUndefined();
  });

  it("8. «Мне нужен ЛОР» → цена → «давай на завтра» (правила)", async () => {
    const t = setup();
    let r = await t.say("Мне нужен ЛОР");
    expect(text(r)).toMatch(/Елена Образцова\. Выберите день/);
    expect(text(r)).not.toMatch(/беспокоит|травм/);
    r = await t.say("А сколько стоит приём?");
    expect(text(r)).toMatch(/Приём оториноларинголога \(ЛОР\) — 2 100 ₽/);
    expect(labels(r)).toContain("вт, 20 окт");
    r = await t.say("Ладно, давай на завтра");
    expect(text(r)).toMatch(/Елена Образцова, вт, 20 окт\. Выберите время/);
  });

  it("8a. то же с GPT: вопрос о цене не теряет контекст записи", async () => {
    const model = new ScriptedModel(({ text: t }) => {
      if (/лор/i.test(t))
        return raw({
          action: "list_available_slots",
          specialty_id: "ent",
          reply:
            "Конечно. Могу показать свободное время к ЛОРу. Вам удобнее сегодня, завтра или другую дату?",
        });
      if (/стоит/.test(t))
        return raw({ action: "answer_clinic_question", info_topic: "prices" });
      if (/завтра/.test(t))
        return raw({ action: "list_available_slots", date: "2026-10-20" });
      return raw();
    });
    const t = setup({ model });
    let r = await t.say("Мне нужен ЛОР");
    expect(text(r)).toMatch(/Вам удобнее сегодня, завтра/);
    r = await t.say("А сколько стоит приём?");
    expect(text(r)).toMatch(/2 100 ₽/);
    expect(t.flow()).toMatchObject({ step: "day", doctorId: "obraztsova" });
    r = await t.say("Ладно, давай на завтра");
    expect(text(r)).toMatch(/Елена Образцова, вт, 20 окт\. Выберите время/);
  });
});

describe("9–10. подбор специалистов", () => {
  it("9. несколько врачей одной специальности: список, выбор, ближайшее время", async () => {
    const t = setup();
    let r = await t.say("хочу записаться к терапевту");
    expect(text(r)).toMatch(
      /Анна Тестова — ближайшее время: пн, 19 окт, 10:00/,
    );
    expect(text(r)).toMatch(
      /Павел Примеров — ближайшее время: вт, 20 окт, 10:00/,
    );
    expect(labels(r)).toEqual(
      expect.arrayContaining([
        "Анна Тестова",
        "Павел Примеров",
        "Ближайшее время",
      ]),
    );
    const viaDoctor = await t.press(r, "Павел Примеров");
    expect(text(viaDoctor)).toMatch(/Павел Примеров\. Выберите день/);
    r = await t.say("назад");
    r = await t.press(r, "Ближайшее время");
    expect(text(r)).toMatch(
      /Анна Тестова \(Терапевт\)[\s\S]*пн, 19 окт, 10:00/,
    );
  });

  it("9a. врач и дата уже названы — сразу выбор времени", async () => {
    const t = setup();
    const r = await t.say("запишите к Примерову на завтра");
    expect(text(r)).toMatch(/Павел Примеров, вт, 20 окт\. Выберите время/);
  });

  it("10. нужного специалиста нет — честно и с администратором", async () => {
    const t = setup();
    const r = await t.say("Нужен кардиолог");
    expect(text(r)).toMatch(/нет кардиолога/);
    expect(labels(r)).toContain("Позвать администратора");

    const model = new ScriptedModel(() =>
      raw({ action: "specialist_unavailable" }),
    );
    const g = setup({ model });
    expect(text(await g.say("Есть у вас гинеколог?"))).toMatch(
      /нет гинеколога/,
    );
  });
});

describe("11–12. отказоустойчивость", () => {
  it("11. OpenAI недоступен: разговор и запись продолжаются по правилам", async () => {
    const errors: string[] = [];
    const model = new OpenAiConversationModel(
      fictionalClinic,
      new OpenAiClient({
        apiKey: "sk-test-0000000000000000000000",
        model: "gpt-5.6-luna",
        fetch: (async () => {
          throw new TypeError("fetch failed");
        }) as typeof fetch,
        now: () => NOW,
        onError: (m) => errors.push(m),
      }),
    );
    const t = setup({ model });
    let r = await t.say("болит колено");
    expect(text(r)).toMatch(/после травмы/);
    r = await t.say("без травмы, уже неделю");
    expect(text(r)).toMatch(/сильный отёк/);
    r = await t.say("нет");
    expect(text(r)).toMatch(/травматологу-ортопеду/);
    r = await t.press(r, "Ближайшее время");
    r = await t.press(r, "Подтвердить");
    expect(text(r)).toMatch(/подтверждена/);
    expect(errors[0]).toMatch(/openai request failed/);
    expect(errors.join()).not.toMatch(/колен/);
  });

  it("11a. телефон и почта из жалобы не уходят в OpenAI и не хранятся в памяти", async () => {
    const bodies: string[] = [];
    const model = new OpenAiConversationModel(
      fictionalClinic,
      new OpenAiClient({
        apiKey: "sk-test-0000000000000000000000",
        model: "gpt-5.6-luna",
        fetch: (async (_url: unknown, init?: RequestInit) => {
          bodies.push(String(init?.body));
          throw new TypeError("fetch failed");
        }) as typeof fetch,
        now: () => NOW,
        onError: () => {},
      }),
    );
    const t = setup({ model });
    // Без запятой: контакты попадают в первую фразу, из которой берётся суть.
    await t.say(
      "болит колено звоните 8 916 123 45 67 или пишите ivan.petrov@mail.ru",
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("суть: болит колено");
    expect(bodies[0]).not.toMatch(/916|123 45|ivan|mail\.ru/);
    const summary = t.memory().complaint?.summary ?? "";
    expect(summary).toContain("[телефон скрыт]");
    expect(summary).not.toMatch(/916|ivan/);
  });

  it("11b. контакты в ответе модели не попадают в память разговора", async () => {
    const t = setup({
      model: new ScriptedModel(() =>
        raw({
          action: "ask_clarification",
          question: "trauma",
          complaint_area: "joint",
          complaint_summary: "колено, тел. +7 916 123-45-67",
          reply: "Подскажите, боль появилась после травмы?",
        }),
      ),
    });
    // Симптома в тексте нет — правила жалобу не распознают, суть берётся у модели.
    await t.say("хочу показать врачу колено");
    expect(t.memory().complaint?.area).toBe("joint");
    expect(t.memory().complaint?.summary).not.toMatch(/916/);
  });

  it("12. перезапуск процесса: разговор продолжается с того же вопроса", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bot-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "bot.sqlite");
    const first = new SqliteStore(path);
    const a = setup({ store: first });
    await a.say("болит колено");
    await a.say("без травмы");
    first.close();

    const second = new SqliteStore(path);
    // Закрыть до удаления папки: Windows не удаляет открытый файл базы.
    cleanup.push(() => second.close());
    const b = setup({ store: second });
    const r = await b.say("уже дня четыре");
    expect(text(r)).toMatch(/сильный отёк/);
    expect(b.memory()).toMatchObject({ trauma: "no", duration: "дня четыре" });
  });
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

describe("14–18. запись, администратор, медицина, сброс, неверный JSON", () => {
  it("14. подтверждение работает один раз", async () => {
    const t = setup();
    let r = await t.say("хочу к стоматологу");
    r = await t.press(r, "пн, 19 окт");
    r = await t.press(r, "10:00");
    const confirm = r;
    r = await t.say("да");
    expect(text(r)).toMatch(/подтверждена/);
    expect(text(await t.say("да"))).not.toMatch(/подтверждена/);
    expect(text(await t.press(confirm, "Подтвердить"))).toMatch(/устарела/);
    expect(t.schedule.listBookings(PEER)).toHaveLength(1);
  });

  it("15. передача администратору приостанавливает бота и модель", async () => {
    const model = new ScriptedModel(() =>
      raw({
        action: "handoff_to_admin",
        reply: "Конечно, позову администратора.",
      }),
    );
    const t = setup({ model });
    let r = await t.say("хочу поговорить с человеком");
    expect(labels(r)).toContain("Да, позвать");
    r = await t.press(r, "Да, позвать");
    expect(t.bot.isPaused(PEER)).toBe(true);
    const calls = model.calls.length;
    expect(await t.say("алло, вы тут?")).toEqual([]);
    expect(model.calls).toHaveLength(calls);
  });

  it("16. просьба о лекарствах или диагнозе — без назначений, даже если модель их написала", async () => {
    const model = new ScriptedModel(() =>
      raw({
        action: "small_talk",
        reply: "Примите ибупрофен 400 мг и приложите лёд.",
      }),
    );
    const t = setup({ model });
    await t.say("болит колено");
    let r = await t.say("Что выпить от боли?");
    expect(text(r)).toMatch(/не ставлю диагнозы/);
    expect(text(r)).not.toMatch(/ибупрофен|мг|лёд/);
    r = await t.say("Поставьте диагноз, это артрит?");
    expect(text(r)).toMatch(/не ставлю диагнозы/);
    expect(text(r)).not.toMatch(/ибупрофен/);
  });

  it("16a. без запроса совета небезопасный текст модели тоже не показывается", async () => {
    const model = new ScriptedModel(() =>
      raw({
        action: "small_talk",
        reply: "Скорее всего, у вас артрит, ничего страшного.",
      }),
    );
    const t = setup({ model });
    const r = await t.say("ну и ладно");
    expect(text(r)).not.toMatch(/артрит|ничего страшного/);
  });

  it("17. «сброс» удаляет историю и память разговора", async () => {
    const t = setup();
    await t.say("болит колено");
    await t.say("без травмы");
    const r = await t.say("сброс");
    expect(text(r)).toMatch(/История разговора удалена/);
    const conv = t.memory();
    expect(conv.complaint).toBeUndefined();
    expect(conv.trauma).toBeUndefined();
    expect(JSON.stringify(t.store.load(PEER))).not.toMatch(/колен|травм/);
    // Старый вопрос больше не ждёт ответа.
    expect(text(await t.say("уже дня четыре"))).not.toMatch(/сильный отёк/);
  });

  it("17a. история удаляется по сроку хранения", async () => {
    const t = setup();
    await t.say("болит колено");
    expect(
      t.store.pruneSessions(new Date(NOW.getTime() + 1000).toISOString()),
    ).toBe(1);
    expect(t.store.load(PEER)).toBeUndefined();
  });

  it("18. неожиданный JSON модели не приводит к действиям", async () => {
    const answers: unknown[] = [
      { action: "confirm_booking", reply: "Записал!" },
      "не JSON",
      raw({
        action: "start_booking",
        doctor_id: "dr-house",
        date: "завтра",
        time: "25:99",
        reply: "Записал вас на 10:00!",
      }),
    ];
    const model = new ScriptedModel(() => answers.shift());
    const t = setup({ model });
    let r = await t.say("запишите меня");
    expect(text(r)).not.toMatch(/Записал/);
    r = await t.say("запишите меня");
    expect(text(r)).not.toMatch(/Записал/);
    r = await t.say("запишите к доктору Хаусу");
    expect(text(r)).not.toMatch(/Записал|10:00/);
    expect(text(r)).toMatch(/Выберите направление/);
    expect(t.schedule.listBookings(PEER)).toHaveLength(0);
  });
});
