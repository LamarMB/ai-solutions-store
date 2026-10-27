import { describe, expect, it } from "vitest";
import { createBot } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { KeyedQueue } from "@/bot/concurrency";
import {
  sanitizeDecision,
  type ConversationInput,
  type ConversationModel,
} from "@/bot/conversation/model";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";
import type { VkApi } from "@/bot/vk/api";
import type { VkUpdate } from "@/bot/vk/longpoll";
import { createVkRunner, peerOf } from "@/bot/vk/runner";

/*
 * Параллельная обработка событий ВКонтакте (BOT_CONCURRENCY): пациенты —
 * одновременно, сообщения одного пациента — по порядку; истории, ответы
 * модели и записи не смешиваются. Вымышленная клиника и VK ID.
 */

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const FIRST = 7_000_001;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decision = (reply: string) => ({
  action: "small_talk",
  reply,
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
});

function setup({
  patients = 2,
  concurrency = 8,
  model,
}: {
  patients?: number;
  concurrency?: number;
  model?: ConversationModel;
} = {}) {
  const store = new SqliteStore(":memory:");
  const schedule = new ClinicSchedule(fictionalClinic, store, () => NOW);
  const sends: { peer: number; text: string }[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const api = {
    // Отправка во ВКонтакте «занимает» случайное время — порядок завершения перемешан.
    call: async (method: string, params: Record<string, unknown>) => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await delay(1 + Math.random() * 8);
      inFlight--;
      if (method === "messages.send")
        sends.push({
          peer: Number(params.peer_id),
          text: String(params.message),
        });
      return 1;
    },
  } as unknown as VkApi;
  const logs: string[] = [];
  const bot = createBot({
    clinic: fictionalClinic,
    schedule,
    sessions: store,
    interpreter: new RuleInterpreter(fictionalClinic),
    model,
    messagesPerMinute: 1000,
    now: () => NOW,
  });
  const runner = createVkRunner({
    api,
    bot,
    store,
    allowedUserIds: new Set(
      Array.from({ length: patients }, (_, i) => FIRST + i),
    ),
    now: () => NOW,
    log: (m) => logs.push(m),
  });
  const queue = new KeyedQueue<number>({ concurrency, limit: 1000 });
  let seq = 0;
  const message = (peer: number, text: string): VkUpdate => ({
    type: "message_new",
    event_id: `ev${++seq}`,
    object: {
      message: { id: seq, from_id: peer, peer_id: peer, text },
      client_info: {
        keyboard: true,
        inline_keyboard: false,
        button_actions: ["text"],
      },
    },
  });
  const dispatch = (update: VkUpdate) =>
    queue.push(peerOf(update), () => runner.onUpdate(update));
  return {
    store,
    schedule,
    sends,
    logs,
    message,
    dispatch,
    queue,
    peak: () => peakInFlight,
    textFor: (peer: number) =>
      sends.filter((s) => s.peer === peer).map((s) => s.text),
  };
}

describe("VK: параллельная обработка", () => {
  it("сообщения одного пациента — по порядку; пациенты — одновременно", async () => {
    const t = setup({ patients: 6 });
    const peers = Array.from({ length: 6 }, (_, i) => FIRST + i);
    // Все сообщения всех пациентов поступают разом, одной пачкой.
    await Promise.all(
      peers.flatMap((peer, i) =>
        [
          "Хочу записаться к терапевту",
          "Анна Тестова",
          "ср, 21 окт",
          ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"][i],
        ].map((text) => t.dispatch(t.message(peer, text))),
      ),
    );
    // Если бы порядок нарушился, пациент не дошёл бы до подтверждения.
    for (const [i, peer] of peers.entries()) {
      const last = t.textFor(peer).at(-1)!;
      expect(last, String(peer)).toMatch(/Проверьте запись/);
      expect(last).toContain(
        ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"][i],
      );
    }
    expect(t.peak()).toBeGreaterThan(1);
    await Promise.all(peers.map((peer) => t.dispatch(t.message(peer, "да"))));
    for (const peer of peers)
      expect(t.schedule.listBookings(peer)).toHaveLength(1);
  });

  it("двое одновременно подтверждают одно время — одна запись, второй получает отказ", async () => {
    const t = setup();
    const [a, b] = [FIRST, FIRST + 1];
    for (const peer of [a, b])
      for (const text of [
        "Хочу записаться к терапевту",
        "Анна Тестова",
        "ср, 21 окт",
        "10:00",
      ])
        await t.dispatch(t.message(peer, text));
    await Promise.all([
      t.dispatch(t.message(a, "да")),
      t.dispatch(t.message(b, "да")),
    ]);
    const booked = [a, b].filter(
      (peer) => t.schedule.listBookings(peer).length === 1,
    );
    expect(booked).toHaveLength(1);
    const loser = booked[0] === a ? b : a;
    expect(t.textFor(loser).at(-1)).toMatch(/занял/);
  });

  it("повторно доставленное событие (в том числе одновременно) обрабатывается один раз", async () => {
    const t = setup();
    const update = t.message(FIRST, "Какие врачи есть?");
    await Promise.all([t.dispatch(update), t.dispatch(update)]);
    await t.dispatch(update);
    expect(t.textFor(FIRST)).toHaveLength(1);
  });

  it("ответы модели не смешиваются: каждый получает ответ на своё сообщение", async () => {
    const words = [
      "альфа",
      "бета",
      "гамма",
      "дельта",
      "эпсилон",
      "дзета",
      "тета",
      "каппа",
      "лямбда",
      "сигма",
    ];
    const model: ConversationModel = {
      async decide(input: ConversationInput) {
        // Модель отвечает с разной задержкой — ответы приходят вперемешку.
        await delay(Math.random() * 20);
        const word = words.find((w) => input.text.includes(w)) ?? "?";
        return sanitizeDecision(
          decision(`Принято: ${word}, собеседник ${input.peerId}`),
          fictionalClinic,
        );
      },
    };
    const t = setup({ patients: words.length, model });
    await Promise.all(
      words.map((word, i) =>
        t.dispatch(
          t.message(FIRST + i, `Подскажите про парковку у клиники, ${word}`),
        ),
      ),
    );
    for (const [i, word] of words.entries()) {
      const text = t.textFor(FIRST + i).join("\n");
      expect(text).toContain(`Принято: ${word}, собеседник ${FIRST + i}`);
      for (const other of words.filter((w) => w !== word))
        expect(text).not.toContain(`Принято: ${other}`);
    }
    // В журнале нет текста сообщений.
    expect(t.logs.join("\n")).not.toMatch(/парковк|альфа|бета/);
  });

  it("без параллельности (BOT_CONCURRENCY=1) — по одному, как раньше", async () => {
    const t = setup({ patients: 4, concurrency: 1 });
    await Promise.all(
      [0, 1, 2, 3].map((i) =>
        t.dispatch(t.message(FIRST + i, "Какие врачи есть?")),
      ),
    );
    expect(t.peak()).toBe(1);
    expect(t.sends).toHaveLength(4);
  });
});
