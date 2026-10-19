import { describe, expect, it } from "vitest";
import { createBot } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";
import { VkApiError, type VkApi } from "@/bot/vk/api";
import type { VkUpdate } from "@/bot/vk/longpoll";
import {
  ATTACHMENTS_TEXT,
  createVkRunner,
  ERROR_TEXT,
  maskId,
  NOT_ALLOWED_TEXT,
  VkAdminNotifier,
} from "@/bot/vk/runner";

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const PATIENT = 123456111;
const OTHER = 123456222;
const STRANGER = 999;
const ADMIN = 555;

type Call = { method: string; params: Record<string, unknown> };

function setup({
  failOnSend,
  rejectOpenApp,
  miniApp,
}: {
  failOnSend?: boolean;
  rejectOpenApp?: boolean;
  miniApp?: boolean;
} = {}) {
  let now = NOW;
  const clock = () => now;
  const store = new SqliteStore(":memory:");
  const schedule = new ClinicSchedule(fictionalClinic, store, clock);
  const calls: Call[] = [];
  const api = {
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (failOnSend && method === "messages.send")
        throw new VkApiError(901, "Can't send messages", method);
      if (
        rejectOpenApp &&
        method === "messages.send" &&
        String(params.keyboard ?? "").includes("open_app")
      )
        throw new VkApiError(911, "Keyboard format is invalid", method);
      return 1;
    },
  } as unknown as VkApi;
  const logs: string[] = [];
  const bot = createBot({
    clinic: fictionalClinic,
    schedule,
    sessions: store,
    interpreter: new RuleInterpreter(fictionalClinic),
    notifier: new VkAdminNotifier(api, 242364009, ADMIN, clock),
    now: clock,
  });
  const runner = createVkRunner({
    api,
    bot,
    store,
    allowedUserIds: new Set([PATIENT, OTHER]),
    miniApp: miniApp ? { appId: 54834865, groupId: 242364009 } : undefined,
    now: clock,
    log: (m) => logs.push(m),
  });
  let seq = 0;
  const message = (
    from: number,
    text: string,
    extra: Record<string, unknown> = {},
  ): VkUpdate => ({
    type: "message_new",
    event_id: `ev${++seq}`,
    object: {
      message: {
        id: seq,
        from_id: from,
        peer_id: from,
        text,
        ...extra,
      },
      client_info: {
        keyboard: true,
        inline_keyboard: true,
        button_actions: ["text", "callback", ...(miniApp ? ["open_app"] : [])],
      },
    },
  });
  const click = (from: number, payload: unknown): VkUpdate => ({
    type: "message_event",
    event_id: `ev${++seq}`,
    object: {
      user_id: from,
      peer_id: from,
      event_id: `click${seq}`,
      payload,
    },
  });
  const sent = (peer: number) =>
    calls.filter(
      (c) => c.method === "messages.send" && c.params.peer_id === peer,
    );
  const lastButtons = (peer: number) => {
    const withKeyboard = sent(peer).filter((c) => c.params.keyboard);
    const keyboard = JSON.parse(String(withKeyboard.at(-1)!.params.keyboard));
    return (
      keyboard.buttons as { action: { label: string; payload: string } }[][]
    )
      .flat()
      .map((b) => ({
        label: b.action.label,
        payload: JSON.parse(b.action.payload),
      }));
  };
  /** Нажимает callback-кнопку из последнего сообщения пациента. */
  const pressUpdate = (peer: number, label: string) => {
    const button = lastButtons(peer).find((b) => b.label === label);
    if (!button) throw new Error(`Нет кнопки «${label}»`);
    return click(peer, button.payload);
  };
  return {
    runner,
    store,
    schedule,
    bot,
    calls,
    logs,
    sent,
    lastButtons,
    message,
    click,
    pressUpdate,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

describe("VK: доступ и повторы", () => {
  it("посторонний получает одно уведомление в сутки, бот с ним не работает", async () => {
    const t = setup();
    await t.runner.onUpdate(t.message(STRANGER, "Записаться"));
    await t.runner.onUpdate(t.message(STRANGER, "Записаться"));
    expect(t.sent(STRANGER).map((c) => c.params.message)).toEqual([
      NOT_ALLOWED_TEXT,
    ]);
    t.advance(25 * 60 * 60 * 1000);
    await t.runner.onUpdate(t.message(STRANGER, "ещё раз"));
    expect(t.sent(STRANGER)).toHaveLength(2);
    expect(t.store.load(STRANGER)).toBeUndefined();
  });

  it("повторно доставленное событие не обрабатывается", async () => {
    const t = setup();
    const update = t.message(PATIENT, "начать");
    await t.runner.onUpdate(update);
    const count = t.sent(PATIENT).length;
    await t.runner.onUpdate(update);
    expect(t.sent(PATIENT)).toHaveLength(count);
    expect(t.logs).toContain("duplicate message_new skipped");
  });

  it("беседы и сообщения от сообществ игнорируются", async () => {
    const t = setup();
    await t.runner.onUpdate({
      type: "message_new",
      event_id: "chat",
      object: {
        message: {
          id: 1,
          from_id: PATIENT,
          peer_id: 2_000_000_001,
          text: "привет",
        },
      },
    });
    await t.runner.onUpdate({
      type: "message_new",
      event_id: "group",
      object: { message: { id: 2, from_id: -5, peer_id: -5, text: "привет" } },
    });
    expect(t.calls).toHaveLength(0);
  });

  it("вложения не принимаются", async () => {
    const t = setup();
    await t.runner.onUpdate(
      t.message(PATIENT, "", { attachments: [{ type: "photo" }] }),
    );
    expect(t.sent(PATIENT).map((c) => c.params.message)).toEqual([
      ATTACHMENTS_TEXT,
    ]);
  });

  it("логи без текста сообщений и полных VK ID", async () => {
    const t = setup();
    await t.runner.onUpdate(t.message(PATIENT, "Где вы находитесь?"));
    expect(t.logs.join("\n")).not.toContain("находитесь");
    expect(t.logs.join("\n")).not.toContain(String(PATIENT));
    expect(maskId(123456789)).toBe("id…789");
  });
});

describe("VK: сценарий в сообщениях сообщества", () => {
  it("кнопка «Начать» → запись по callback-кнопкам → «Мои записи»", async () => {
    const t = setup();
    await t.runner.onUpdate(
      t.message(PATIENT, "Начать", { payload: '{"command":"start"}' }),
    );
    expect(t.lastButtons(PATIENT).map((b) => b.label)).toContain(
      "Записаться на приём",
    );
    for (const label of [
      "Записаться на приём",
      "Терапевт",
      "Анна Тестова",
      "пн, 19 окт",
      "10:00",
      "Подтвердить",
    ]) {
      await t.runner.onUpdate(t.pressUpdate(PATIENT, label));
    }
    // На каждое нажатие — ответ ВКонтакте, чтобы кнопка не «крутилась».
    expect(
      t.calls.filter((c) => c.method === "messages.sendMessageEventAnswer"),
    ).toHaveLength(6);
    expect(String(t.sent(PATIENT).at(-1)!.params.message)).toContain(
      "подтверждена (тестовое расписание)",
    );
    expect(t.schedule.listBookings(PATIENT)).toHaveLength(1);

    // Повтор нажатия «Подтвердить» тем же событием и новым — вторая запись не создаётся.
    await t.runner.onUpdate(t.click(PATIENT, { a: "ok" }));
    expect(t.schedule.listBookings(PATIENT)).toHaveLength(1);
  });

  it("два пациента на одно время: второй получает отказ", async () => {
    const t = setup();
    for (const peer of [PATIENT, OTHER]) {
      await t.runner.onUpdate(t.message(peer, "начать"));
      for (const label of [
        "Записаться на приём",
        "Терапевт",
        "Анна Тестова",
        "пн, 19 окт",
        "10:00",
      ])
        await t.runner.onUpdate(t.pressUpdate(peer, label));
    }
    await t.runner.onUpdate(t.pressUpdate(PATIENT, "Подтвердить"));
    await t.runner.onUpdate(t.pressUpdate(OTHER, "Подтвердить"));
    expect(t.schedule.listBookings(PATIENT)).toHaveLength(1);
    expect(t.schedule.listBookings(OTHER)).toHaveLength(0);
    expect(String(t.sent(OTHER).at(-1)!.params.message)).toMatch(/занял/);
  });

  it("random_id детерминирован: повторная отправка того же ответа отбрасывается ВКонтакте", async () => {
    const a = setup();
    const b = setup();
    await a.runner.onUpdate(a.message(PATIENT, "начать"));
    await b.runner.onUpdate(b.message(PATIENT, "начать"));
    expect(a.sent(PATIENT)[0].params.random_id).toBe(
      b.sent(PATIENT)[0].params.random_id,
    );
  });

  it("передача администратору: уведомление, пауза, возврат к боту", async () => {
    const t = setup();
    await t.runner.onUpdate(t.message(PATIENT, "позовите администратора"));
    await t.runner.onUpdate(t.pressUpdate(PATIENT, "Да, позвать"));
    const notice = t.sent(ADMIN);
    expect(notice).toHaveLength(1);
    expect(String(notice[0].params.message)).toContain(
      `https://vk.com/gim242364009?sel=${PATIENT}`,
    );
    expect(t.bot.isPaused(PATIENT)).toBe(true);

    const before = t.sent(PATIENT).length;
    await t.runner.onUpdate(t.message(PATIENT, "алло"));
    expect(t.sent(PATIENT)).toHaveLength(before);

    await t.runner.onUpdate(t.message(PATIENT, "бот"));
    expect(t.bot.isPaused(PATIENT)).toBe(false);
    expect(t.sent(PATIENT).length).toBeGreaterThan(before);
  });

  it("ответ администратора вручную ставит бота на паузу", async () => {
    const t = setup();
    await t.runner.onUpdate({
      type: "message_reply",
      event_id: "reply1",
      object: { peer_id: PATIENT, from_id: -242364009, admin_author_id: ADMIN },
    });
    expect(t.bot.isPaused(PATIENT)).toBe(true);
    // Ответ самого бота (без admin_author_id) паузу не ставит.
    await t.runner.onUpdate({
      type: "message_reply",
      event_id: "reply2",
      object: { peer_id: OTHER, from_id: -242364009 },
    });
    expect(t.bot.isPaused(OTHER)).toBe(false);
  });
});

describe("VK: разговор обычным текстом", () => {
  it("«болит колено» → уточнения → запись; повтор события не даёт второго ответа и записи", async () => {
    const t = setup();
    for (const text of [
      "Здравствуйте, у меня болит колено",
      "Без травмы",
      "Уже дня четыре",
      "Нет, просто иногда ноет",
    ])
      await t.runner.onUpdate(t.message(PATIENT, text));
    expect(String(t.sent(PATIENT).at(-1)!.params.message)).toMatch(
      /травматологу-ортопеду/,
    );
    await t.runner.onUpdate(t.pressUpdate(PATIENT, "Ближайшее время"));
    const confirm = t.pressUpdate(PATIENT, "Подтвердить");
    await t.runner.onUpdate(confirm);
    const sentAfterConfirm = t.sent(PATIENT).length;
    // ВКонтакте доставил то же событие ещё раз.
    await t.runner.onUpdate(confirm);
    expect(t.sent(PATIENT)).toHaveLength(sentAfterConfirm);
    expect(t.schedule.listBookings(PATIENT)).toMatchObject([
      { doctorId: "maketov" },
    ]);
  });
});

describe("VK: ошибки", () => {
  it("сбой бота — короткое сообщение пациенту, детали только в логе", async () => {
    const t = setup();
    const broken = createVkRunner({
      api: {
        call: async (method: string, params: Record<string, unknown>) => {
          t.calls.push({ method, params });
          return 1;
        },
      } as unknown as VkApi,
      bot: {
        ...t.bot,
        handle: async () => {
          throw new Error("disk full");
        },
      },
      store: t.store,
      allowedUserIds: new Set([PATIENT]),
      log: (m) => t.logs.push(m),
    });
    await broken.onUpdate(t.message(PATIENT, "начать"));
    expect(t.sent(PATIENT).map((c) => c.params.message)).toEqual([ERROR_TEXT]);
    expect(t.logs.join("\n")).not.toContain("disk full");
  });

  it("ошибка отправки ВКонтакте не роняет обработку", async () => {
    const t = setup({ failOnSend: true });
    await expect(
      t.runner.onUpdate(t.message(PATIENT, "начать")),
    ).resolves.toBeUndefined();
    expect(t.logs.some((l) => l.includes("vk 901"))).toBe(true);
  });
});

describe("VK: кнопка Mini App", () => {
  const openAppButtons = (keyboard: unknown) =>
    (
      JSON.parse(String(keyboard)) as {
        buttons: { action: { type: string; owner_id?: number } }[][];
      }
    ).buttons
      .flat()
      .filter((b) => b.action.type === "open_app");

  it("главное меню содержит кнопку open_app сообщества", async () => {
    const t = setup({ miniApp: true });
    await t.runner.onUpdate(t.message(PATIENT, "меню"));
    const last = t
      .sent(PATIENT)
      .filter((c) => c.params.keyboard)
      .at(-1)!;
    const buttons = openAppButtons(last.params.keyboard);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].action.owner_id).toBe(-242364009);
  });

  it("без VK_MINIAPP_ID кнопки нет", async () => {
    const t = setup();
    await t.runner.onUpdate(t.message(PATIENT, "меню"));
    for (const c of t.sent(PATIENT).filter((c) => c.params.keyboard))
      expect(openAppButtons(c.params.keyboard)).toHaveLength(0);
  });

  it("ВКонтакте отклонил клавиатуру с open_app — то же сообщение уходит без неё", async () => {
    const t = setup({ miniApp: true, rejectOpenApp: true });
    await t.runner.onUpdate(t.message(PATIENT, "меню"));
    expect(
      t.logs.some((l) => l.includes("open_app keyboard rejected: vk 911")),
    ).toBe(true);
    const delivered = t
      .sent(PATIENT)
      .filter((c) => !String(c.params.keyboard ?? "").includes("open_app"));
    const last = delivered.at(-1)!;
    expect(String(last.params.message)).toContain("Чем могу помочь");
    expect(String(last.params.keyboard)).toContain("Записаться на приём");
  });
});
