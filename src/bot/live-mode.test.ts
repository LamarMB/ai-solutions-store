import { describe, expect, it } from "vitest";
import { createBot } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { demoMarkers } from "@/bot/clinic/live-check";
import type { Clinic } from "@/bot/clinic/types";
import { describeAccess, loadBotConfig, type BotAccess } from "@/bot/config";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import { conversationInstructions } from "@/bot/llm/openai-conversation";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";
import type { VkApi } from "@/bot/vk/api";
import type { VkUpdate } from "@/bot/vk/longpoll";
import {
  createVkRunner,
  NOT_ALLOWED_TEXT,
  NOT_YET_OPEN_TEXT,
  VkAdminNotifier,
} from "@/bot/vk/runner";

/**
 * Боевой режим (BOT_MODE=live): бот клиники-клиента отвечает всем пациентам
 * и не говорит о «демо», «вымышленных» данных и «тестовом расписании».
 */

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const ADMIN = 555;
const TESTER = 123456111;
/** Любой пациент, которого нет ни в каком списке. */
const PATIENT = 700000001;

/** Справочник, заполненный клиникой в панели (данные вымышленные, но без пометок). */
const DOCTOR_NAMES = [
  "Анна Смирнова",
  "Павел Орлов",
  "Мария Белова",
  "Олег Егоров",
  "Елена Козлова",
  "Игорь Соколов",
];
const liveClinic: Clinic = {
  ...fictionalClinic,
  name: "Клиника «Пример»",
  address: "г. Примерный, ул. Садовая, д. 1",
  route: "Остановка «Садовая», вход со двора, парковка у здания.",
  doctors: fictionalClinic.doctors.map((d, i) => ({
    ...d,
    name: DOCTOR_NAMES[i] ?? `Врач ${i + 1}`,
  })),
};

/** Слова, которых пациент клиники-клиента не должен видеть. */
const DEMO_WORDS = /демо|вымышл|тестов|демонстрац/i;

function setup({
  demo,
  access,
  clinic = liveClinic,
}: {
  demo: boolean;
  access: BotAccess;
  clinic?: Clinic;
}) {
  const clock = () => NOW;
  const store = new SqliteStore(":memory:");
  const schedule = new ClinicSchedule(clinic, store, clock);
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const api = {
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return 1;
    },
  } as unknown as VkApi;
  const bot = createBot({
    clinic,
    schedule,
    sessions: store,
    interpreter: new RuleInterpreter(clinic),
    notifier: new VkAdminNotifier(api, 242364009, ADMIN, clock, demo),
    demo,
    now: clock,
  });
  const runner = createVkRunner({
    api,
    bot,
    store,
    allowedUserIds: access,
    demo,
    now: clock,
  });
  let seq = 0;
  const message = (from: number, text: string, payload?: string): VkUpdate => ({
    type: "message_new",
    event_id: `ev${++seq}`,
    object: {
      message: { id: seq, from_id: from, peer_id: from, text, payload },
      client_info: {
        keyboard: true,
        inline_keyboard: true,
        button_actions: ["text", "callback"],
      },
    },
  });
  const click = (from: number, payload: unknown): VkUpdate => ({
    type: "message_event",
    event_id: `ev${++seq}`,
    object: { user_id: from, peer_id: from, event_id: `c${seq}`, payload },
  });
  const sent = (peer: number) =>
    calls
      .filter((c) => c.method === "messages.send" && c.params.peer_id === peer)
      .map((c) => c.params);
  const press = async (peer: number, label: string) => {
    const keyboard = sent(peer)
      .filter((p) => p.keyboard)
      .at(-1)!.keyboard;
    const buttons = (
      JSON.parse(String(keyboard)).buttons as {
        action: { label: string; payload: string };
      }[][]
    ).flat();
    const button = buttons.find((b) => b.action.label === label);
    if (!button) throw new Error(`Нет кнопки «${label}»`);
    await runner.onUpdate(click(peer, JSON.parse(button.action.payload)));
  };
  return { runner, store, schedule, sent, message, click, press };
}

const START = '{"command":"start"}';

describe("BOT_MODE: настройки", () => {
  const base = {
    VK_GROUP_ID: "242364009",
    VK_GROUP_TOKEN: "vk1.a.secret-token-value-123456",
  };

  it("по умолчанию — демо: обязателен список тестовых аккаунтов", () => {
    const result = loadBotConfig({ ...base, VK_ALLOWED_USER_IDS: "111" });
    expect(result.ok && result.config.mode).toBe("demo");
    expect(result.ok && describeAccess(result.config)).toBe(
      "режим: демо, доступ: только тестовые аккаунты (1)",
    );
    const empty = loadBotConfig(base);
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.errors).toEqual([
      "VK_ALLOWED_USER_IDS: нужен хотя бы один тестовый VK ID (BOT_MODE=demo)",
    ]);
  });

  it("live без списка — бот отвечает всем пациентам", () => {
    const result = loadBotConfig({
      ...base,
      BOT_MODE: "live",
      VK_ALLOWED_USER_IDS: "",
    });
    expect(result.ok && result.config.vk.allowedUserIds).toBe("all");
    expect(result.ok && describeAccess(result.config)).toBe(
      "режим: клиника-клиент (live), доступ: все пациенты",
    );
  });

  it("live со списком — только эти аккаунты (проверка перед открытием)", () => {
    const result = loadBotConfig({
      ...base,
      BOT_MODE: "live",
      VK_ALLOWED_USER_IDS: "111, 222",
    });
    expect(result.ok && result.config.mode).toBe("live");
    expect(
      result.ok && [...(result.config.vk.allowedUserIds as Set<number>)],
    ).toEqual([111, 222]);
  });

  it("неизвестный режим и открытый доступ с Mini App — ошибки", () => {
    const wrong = loadBotConfig({ ...base, BOT_MODE: "prod" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok)
      expect(wrong.errors.map((e) => e.split(":")[0])).toContain("BOT_MODE");

    const miniApp = loadBotConfig({
      ...base,
      BOT_MODE: "live",
      VK_MINIAPP_ID: "54834865",
    });
    expect(miniApp.ok).toBe(false);
    if (!miniApp.ok)
      expect(miniApp.errors.map((e) => e.split(":")[0])).toEqual([
        "VK_MINIAPP_ID",
      ]);
    // Со списком тестовых аккаунтов Mini App по-прежнему можно проверять.
    expect(
      loadBotConfig({
        ...base,
        BOT_MODE: "live",
        VK_ALLOWED_USER_IDS: "111",
        VK_MINIAPP_ID: "54834865",
      }).ok,
    ).toBe(true);
  });
});

describe("BOT_MODE=live: доступ всем пациентам", () => {
  it("любой пациент: приветствие → справка → запись → администратор — без слов «демо»", async () => {
    const t = setup({ demo: false, access: "all" });
    await t.runner.onUpdate(t.message(PATIENT, "Начать", START));
    expect(String(t.sent(PATIENT)[0].message)).toMatch(
      /^Здравствуйте! Я помощник клиники: Клиника «Пример»\.\n/,
    );

    for (const k of ["prices", "doctors", "address", "route", "prep"])
      await t.runner.onUpdate(t.click(PATIENT, { a: "info", k }));
    const texts = t.sent(PATIENT).map((p) => String(p.message));
    expect(texts.some((m) => m.startsWith("Цены:\n"))).toBe(true);
    expect(texts.some((m) => m.startsWith("Наши врачи:\n"))).toBe(true);

    await t.runner.onUpdate(t.message(PATIENT, "меню"));
    for (const label of [
      "Записаться на приём",
      "Терапевт",
      "Анна Смирнова",
      "пн, 19 окт",
      "10:00",
      "Подтвердить",
    ])
      await t.press(PATIENT, label);
    expect(t.schedule.listBookings(PATIENT)).toHaveLength(1);
    expect(String(t.sent(PATIENT).at(-1)!.message)).toMatch(
      /^Запись №\d+ подтверждена\.\n/,
    );

    await t.runner.onUpdate(t.message(PATIENT, "позовите администратора"));
    await t.press(PATIENT, "Да, позвать");
    const notice = t.sent(ADMIN);
    expect(notice).toHaveLength(1);
    expect(String(notice[0].message)).toMatch(
      /^Пациент просит администратора\. Откройте диалог/,
    );

    for (const text of [...t.sent(PATIENT), ...notice].map((p) =>
      String(p.message),
    ))
      expect(text).not.toMatch(DEMO_WORDS);
  });

  it("кнопки и ответ администратора вручную работают для любого пациента", async () => {
    const t = setup({ demo: false, access: "all" });
    await t.runner.onUpdate(t.click(PATIENT, { a: "info", k: "address" }));
    expect(String(t.sent(PATIENT)[0].message)).toContain("ул. Садовая, д. 1");
    await t.runner.onUpdate({
      type: "message_reply",
      object: { peer_id: PATIENT, admin_author_id: ADMIN },
    });
    const before = t.sent(PATIENT).length;
    await t.runner.onUpdate(t.message(PATIENT, "алло"));
    expect(t.sent(PATIENT)).toHaveLength(before);
  });

  it("live со списком: остальным — нейтральный ответ без «демонстрационный»", async () => {
    const t = setup({ demo: false, access: new Set([TESTER]) });
    await t.runner.onUpdate(t.message(PATIENT, "Записаться"));
    expect(t.sent(PATIENT).map((p) => p.message)).toEqual([NOT_YET_OPEN_TEXT]);
    expect(NOT_YET_OPEN_TEXT).not.toMatch(DEMO_WORDS);
    expect(t.store.load(PATIENT)).toBeUndefined();
    await t.runner.onUpdate(t.message(TESTER, "Начать", START));
    expect(t.sent(TESTER).length).toBeGreaterThan(0);
  });
});

describe("BOT_MODE=demo: как раньше", () => {
  it("пометки «демо» и только тестовые аккаунты", async () => {
    const t = setup({
      demo: true,
      access: new Set([TESTER]),
      clinic: fictionalClinic,
    });
    await t.runner.onUpdate(t.message(PATIENT, "Записаться"));
    expect(t.sent(PATIENT).map((p) => p.message)).toEqual([NOT_ALLOWED_TEXT]);
    await t.runner.onUpdate(t.message(TESTER, "Начать", START));
    expect(String(t.sent(TESTER)[0].message)).toContain(
      "(демо, данные вымышленные)",
    );
    await t.runner.onUpdate(t.click(TESTER, { a: "info", k: "prices" }));
    expect(String(t.sent(TESTER).at(-1)!.message)).toMatch(
      /^Цены \(тестовые, клиника вымышленная\):/,
    );
  });
});

describe("инструкции OpenAI", () => {
  it("live — без «демонстрационной вымышленной клиники» и пометок в справке", () => {
    const live = conversationInstructions(liveClinic, false);
    expect(live).toMatch(
      /^Ты — автоматический помощник администратора клиники «Клиника «Пример»»/,
    );
    expect(live).not.toMatch(DEMO_WORDS);
    expect(conversationInstructions(fictionalClinic)).toContain(
      "демонстрационной вымышленной клиники",
    );
  });
});

describe("проверка справочника перед запуском live", () => {
  it("данные вымышленной клиники из новой базы — бот не запускается", () => {
    const store = new SqliteStore(":memory:");
    const markers = demoMarkers(store.clinic.load());
    expect(markers).toEqual(
      expect.arrayContaining(["название клиники", "адрес", "как добраться"]),
    );
    expect(markers).toContain("врач demonstrova: имя");
  });

  it("справочник клиники-клиента — без замечаний", () => {
    expect(demoMarkers(liveClinic)).toEqual([]);
  });

  it("без ложных срабатываний на медицинских словах", () => {
    const clinic: Clinic = {
      ...liveClinic,
      services: [
        { title: "Лечение демодекоза", specialtyId: "therapist", priceRub: 1 },
        { title: "Аллерготесты", specialtyId: "therapist", priceRub: 1 },
        { title: "Тестовая услуга", specialtyId: "therapist", priceRub: 1 },
      ],
      about: "Демо-версия сайта",
    };
    expect(demoMarkers(clinic)).toEqual([
      "о клинике",
      "услуга «Тестовая услуга»",
    ]);
  });

  it("отключённые врачи не проверяются", () => {
    const clinic: Clinic = {
      ...liveClinic,
      doctors: [
        ...liveClinic.doctors,
        { ...fictionalClinic.doctors[2], id: "old", active: false },
      ],
    };
    expect(demoMarkers(clinic)).toEqual([]);
  });
});
