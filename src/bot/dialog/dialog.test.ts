import { describe, expect, it } from "vitest";
import { createBot } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { ANSWER_MAX } from "@/bot/dialog/dialog";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import type {
  Action,
  BotEvent,
  Interpretation,
  Reply,
  TextInterpreter,
} from "@/bot/dialog/types";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");

function setup(
  now: () => Date = () => NOW,
  store = new SqliteStore(":memory:"),
) {
  const schedule = new ClinicSchedule(fictionalClinic, store, now);
  const bot = createBot({
    clinic: fictionalClinic,
    schedule,
    sessions: store,
    interpreter: new RuleInterpreter(fictionalClinic),
    now,
  });
  return { bot, schedule, store };
}

type Bot = ReturnType<typeof setup>["bot"];

const buttons = (replies: Reply[]) => replies.flatMap((r) => r.buttons.flat());
const text = (replies: Reply[]) => replies.map((r) => r.text).join("\n");

/** Нажимает кнопку с подписью из последнего ответа. */
async function press(bot: Bot, peer: number, last: Reply[], label: string) {
  const button = buttons(last).find((b) => b.label === label);
  if (!button) {
    throw new Error(
      `Нет кнопки «${label}»: ${buttons(last)
        .map((b) => b.label)
        .join(", ")}`,
    );
  }
  return bot.handle(peer, { type: "action", payload: button.action });
}

const send = (bot: Bot, peer: number, event: BotEvent) =>
  bot.handle(peer, event);

/** Проходит запись до шага подтверждения: терапевт → Анна Тестова → день → время. */
async function toConfirm(bot: Bot, peer: number, time = "10:00") {
  let r = await send(bot, peer, { type: "start" });
  r = await press(bot, peer, r, "Записаться на приём");
  r = await press(bot, peer, r, "Терапевт");
  r = await press(bot, peer, r, "Анна Тестова");
  r = await press(bot, peer, r, "пн, 19 окт");
  return press(bot, peer, r, time);
}

describe("сценарий записи", () => {
  it("приветствие → направление → врач → дата → время → подтверждение", async () => {
    const { bot, schedule } = setup();
    const start = await send(bot, 1, { type: "start" });
    expect(text(start)).toMatch(/автоматический помощник/);
    expect(text(start)).toMatch(/не ставлю диагнозы/);

    const confirm = await toConfirm(bot, 1);
    expect(text(confirm)).toMatch(/Проверьте запись/);
    expect(text(confirm)).toMatch(/Анна Тестова \(Терапевт\)/);
    expect(text(confirm)).toMatch(/пн, 19 окт, 10:00/);
    expect(schedule.listBookings(1)).toEqual([]); // до подтверждения записи нет

    const done = await press(bot, 1, confirm, "Подтвердить");
    expect(text(done)).toMatch(
      /Запись №1 подтверждена \(тестовое расписание\)/,
    );
    expect(text(done)).toMatch(/диалог можно закрыть/);
    expect(schedule.listBookings(1).map((b) => [b.doctorId, b.time])).toEqual([
      ["testova", "10:00"],
    ]);
  });

  it("можно отвечать текстом вместо кнопок", async () => {
    const { bot, schedule } = setup();
    let r = await send(bot, 1, { type: "text", text: "Хочу записаться" });
    expect(text(r)).toMatch(/Выберите направление/);
    r = await send(bot, 1, { type: "text", text: "терапевт" });
    expect(text(r)).toMatch(/Выберите врача/);
    r = await send(bot, 1, { type: "text", text: "Анна Тестова" });
    r = await send(bot, 1, { type: "text", text: "пн, 19 окт" });
    r = await send(bot, 1, { type: "text", text: "11:30" });
    expect(text(r)).toMatch(/Подтвердить\?/);
    r = await send(bot, 1, { type: "text", text: "да" });
    expect(text(r)).toMatch(/подтверждена/);
    expect(schedule.listBookings(1)[0].time).toBe("11:30");
  });

  it("«Назад» возвращает на предыдущий шаг", async () => {
    const { bot } = setup();
    const confirm = await toConfirm(bot, 1);
    const time = await press(bot, 1, confirm, "Другое время");
    expect(text(time)).toMatch(/Выберите время/);
    const day = await press(bot, 1, time, "Назад");
    expect(text(day)).toMatch(/Выберите день/);
    const doctor = await press(bot, 1, day, "Назад");
    expect(text(doctor)).toMatch(/Выберите врача/);
  });

  it("много свободного времени — по страницам", async () => {
    const { bot } = setup();
    let r = await send(bot, 1, { type: "start" });
    r = await press(bot, 1, r, "Записаться на приём");
    r = await press(bot, 1, r, "Терапевт");
    r = await press(bot, 1, r, "Павел Примеров"); // вт 10:00–16:00, 12 слотов
    r = await press(bot, 1, r, "вт, 20 окт");
    expect(buttons(r).map((b) => b.label)).toContain("10:00");
    r = await press(bot, 1, r, "Ещё время");
    const labels = buttons(r).map((b) => b.label);
    expect(labels).toContain("13:00");
    expect(labels).not.toContain("10:00");
    expect(labels).toContain("К началу дня");
  });
});

describe("защита от двойного бронирования", () => {
  it("двое выбрали одно время: второй получает отказ и новый список", async () => {
    const { bot, schedule } = setup();
    const first = await toConfirm(bot, 1, "10:00");
    const second = await toConfirm(bot, 2, "10:00");

    expect(text(await press(bot, 1, first, "Подтвердить"))).toMatch(
      /подтверждена/,
    );
    const late = await press(bot, 2, second, "Подтвердить");
    expect(text(late)).toMatch(/только что заняли/);
    expect(buttons(late).map((b) => b.label)).not.toContain("10:00");
    expect(schedule.listBookings(2)).toEqual([]);
  });

  it("повторное нажатие «Подтвердить» не создаёт вторую запись", async () => {
    const { bot, schedule } = setup();
    const confirm = await toConfirm(bot, 1);
    await press(bot, 1, confirm, "Подтвердить");
    const again = await press(bot, 1, confirm, "Подтвердить");
    expect(text(again)).toMatch(/кнопка устарела/);
    expect(schedule.listBookings(1)).toHaveLength(1);
  });

  it("подделанные и устаревшие кнопки ничего не бронируют", async () => {
    const { bot, schedule } = setup();
    await send(bot, 1, { type: "start" });
    for (const payload of [
      { a: "ok" },
      { a: "time", t: "10:00" },
      { a: "day", dt: "2026-10-19" },
      { a: "doc", d: "testova" },
      { a: "cxok" },
      { a: "spec", s: "surgeon" },
      { a: "drop table" },
      "мусор",
      null,
    ]) {
      const r = await send(bot, 1, { type: "action", payload });
      expect(text(r), JSON.stringify(payload)).toMatch(/кнопка устарела/);
    }
    expect(schedule.listBookings(1)).toEqual([]);
  });
});

describe("просмотр и отмена записей", () => {
  it("«Мои записи» → отменить → подтвердить", async () => {
    const { bot, schedule } = setup();
    await press(bot, 1, await toConfirm(bot, 1), "Подтвердить");

    let r = await send(bot, 1, { type: "text", text: "мои записи" });
    expect(text(r)).toMatch(
      /№1: пн, 19 окт, 10:00 — Анна Тестова \(Терапевт\)/,
    );
    r = await press(bot, 1, r, "Отменить №1");
    expect(text(r)).toMatch(/Отменить запись №1\?/);
    r = await press(bot, 1, r, "Да, отменить");
    expect(text(r)).toMatch(/Запись №1 отменена/);
    expect(text(r)).toMatch(/Активных записей нет/);
    expect(schedule.listFreeSlots("testova", "2026-10-19")).toContain("10:00");
  });

  it("«Нет» при отмене оставляет запись", async () => {
    const { bot, schedule } = setup();
    await press(bot, 1, await toConfirm(bot, 1), "Подтвердить");
    let r = await press(
      bot,
      1,
      await send(bot, 1, { type: "text", text: "мои записи" }),
      "Отменить №1",
    );
    r = await press(bot, 1, r, "Нет");
    expect(text(r)).toMatch(/Ваши записи/);
    expect(schedule.listBookings(1)).toHaveLength(1);
  });

  it("чужую запись нельзя отменить даже подделанной кнопкой", async () => {
    const { bot, schedule } = setup();
    await press(bot, 1, await toConfirm(bot, 1), "Подтвердить");
    await send(bot, 2, { type: "text", text: "мои записи" });
    const forged: Action = { a: "cx", b: 1 };
    const r = await send(bot, 2, { type: "action", payload: forged });
    expect(text(r)).toMatch(/кнопка устарела/);
    await send(bot, 2, { type: "action", payload: { a: "cxok" } });
    expect(schedule.listBookings(1)).toHaveLength(1);
  });

  it("лимит активных записей", async () => {
    const { bot, schedule } = setup();
    for (const time of ["10:00", "10:30", "11:00"]) {
      await press(bot, 1, await toConfirm(bot, 1, time), "Подтвердить");
    }
    const r = await press(
      bot,
      1,
      await toConfirm(bot, 1, "11:30"),
      "Подтвердить",
    );
    expect(text(r)).toMatch(/максимальное число активных записей/);
    expect(schedule.listBookings(1)).toHaveLength(3);
  });
});

describe("безопасность и данные", () => {
  it("просьба о лекарствах — отказ без советов и предложение специалиста", async () => {
    const { bot } = setup();
    const complaint = "У меня болит горло и температура, что принять?";
    const r = await send(bot, 1, { type: "text", text: complaint });
    expect(text(r)).toMatch(/не ставлю диагнозы/);
    expect(text(r)).toMatch(/103 или 112/);
    expect(text(r)).not.toMatch(/примите|таблетк|мг/i);
  });

  it("телефон не сохраняется; история удаляется командой «сброс»", async () => {
    const { bot, store } = setup();
    await send(bot, 1, {
      type: "text",
      text: "Меня зовут Иван, телефон 89990001122, хочу записаться",
    });
    expect(JSON.stringify(store.load(1)?.state)).not.toMatch(/8999/);
    await send(bot, 1, { type: "text", text: "сброс" });
    expect(JSON.stringify(store.load(1)?.state)).not.toMatch(/Иван/);
  });

  it("неясный текст — подсказка и текущие кнопки", async () => {
    const { bot } = setup();
    const r = await send(bot, 1, { type: "text", text: "хм, а вот это вот" });
    expect(text(r)).toMatch(/Не совсем понял/);
    expect(buttons(r).length).toBeGreaterThan(0);
  });

  it("просьба позвать администратора — сначала подтверждение", async () => {
    const { bot } = setup();
    const r = await send(bot, 1, {
      type: "text",
      text: "Позовите администратора",
    });
    expect(text(r)).toMatch(/Позвать администратора клиники\?/);
    expect(buttons(r).map((b) => b.label)).toEqual(["Да, позвать", "Нет"]);
  });
});

describe("сессии", () => {
  it("диалог продолжается после перезапуска бота", async () => {
    const store = new SqliteStore(":memory:");
    const first = setup(() => NOW, store).bot;
    let r = await send(first, 1, { type: "start" });
    r = await press(first, 1, r, "Записаться на приём");
    r = await press(first, 1, r, "Терапевт");

    const second = setup(() => NOW, store).bot;
    const next = await press(second, 1, r, "Анна Тестова");
    expect(text(next)).toMatch(/Выберите день/);
  });

  it("resume показывает текущий шаг, не сбрасывая выбор", async () => {
    const { bot } = setup();
    const confirm = await toConfirm(bot, 1);
    const resumed = await send(bot, 1, { type: "resume" });
    expect(text(resumed)).toMatch(/Продолжим с того же места/);
    expect(text(resumed)).toMatch(/Проверьте запись/);
    expect(text(await press(bot, 1, confirm, "Подтвердить"))).toMatch(
      /подтверждена/,
    );
    expect(text(await send(bot, 2, { type: "resume" }))).toMatch(
      /автоматический помощник/,
    );
  });

  it("через сутки неактивности диалог начинается заново", async () => {
    const store = new SqliteStore(":memory:");
    let now = NOW;
    const { bot } = setup(() => now, store);
    let r = await send(bot, 1, { type: "start" });
    r = await press(bot, 1, r, "Записаться на приём");
    r = await press(bot, 1, r, "Терапевт");
    now = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    const late = await press(bot, 1, r, "Анна Тестова");
    expect(text(late)).toMatch(/кнопка устарела/);
    expect(text(late)).toMatch(/Чем могу помочь/);
  });

  it("испорченное сохранённое состояние не ломает бота", async () => {
    const store = new SqliteStore(":memory:");
    store.save(1, { step: "hack", doctorId: 1 }, NOW.toISOString());
    const { bot } = setup(() => NOW, store);
    const r = await send(bot, 1, { type: "text", text: "меню" });
    expect(text(r)).toMatch(/Чем могу помочь/);
  });
});

describe("ограничения кнопок ВКонтакте", () => {
  it("на любом шаге — до 10 кнопок и 6 рядов, подписи до 40 символов, payload до 255", async () => {
    const { bot } = setup();
    const seen: Reply[] = [];
    const visit = async (r: Reply[]) => {
      seen.push(...r);
      return r;
    };
    let r = await visit(await send(bot, 1, { type: "start" }));
    r = await visit(await press(bot, 1, r, "Записаться на приём"));
    for (const specialty of fictionalClinic.specialties) {
      let s = await visit(await press(bot, 1, r, specialty.title));
      for (const doctor of fictionalClinic.doctors.filter(
        (d) => d.specialtyId === specialty.id,
      )) {
        const days = await visit(await press(bot, 1, s, doctor.name));
        const firstDay = buttons(days)[0];
        const times = await visit(
          await bot.handle(1, { type: "action", payload: firstDay.action }),
        );
        await visit(
          await bot.handle(1, {
            type: "action",
            payload: buttons(times)[0].action,
          }),
        );
        s = await visit(
          await send(bot, 1, { type: "action", payload: { a: "back" } }),
        );
        s = await visit(
          await send(bot, 1, { type: "action", payload: { a: "back" } }),
        );
        s = await visit(
          await send(bot, 1, { type: "action", payload: { a: "back" } }),
        );
      }
      r = await visit(await send(bot, 1, { type: "text", text: "записаться" }));
    }
    for (const reply of seen) {
      const all = reply.buttons.flat();
      expect(all.length, reply.text).toBeLessThanOrEqual(10);
      expect(reply.buttons.length, reply.text).toBeLessThanOrEqual(6);
      for (const b of all) {
        expect(b.label.length, b.label).toBeLessThanOrEqual(40);
        expect(JSON.stringify(b.action).length).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("вопросы о клинике", () => {
  it("цены, врачи и адрес — из данных клиники, без модели", async () => {
    const { bot } = setup();
    let r = await send(bot, 1, {
      type: "text",
      text: "Сколько стоит приём терапевта?",
    });
    expect(text(r)).toMatch(/Приём терапевта — 2 000 ₽/);
    expect(text(r)).toMatch(/тестовые/);
    r = await send(bot, 1, { type: "text", text: "Где вы находитесь?" });
    expect(text(r)).toMatch(/ул\. Вымышленная/);
    r = await send(bot, 1, {
      type: "text",
      text: "Какие врачи у вас принимают?",
    });
    expect(text(r)).toMatch(/Анна Тестова — Терапевт/);
  });

  it("вопрос посреди записи не сбрасывает выбор", async () => {
    const { bot } = setup();
    await toConfirm(bot, 1);
    const r = await send(bot, 1, {
      type: "text",
      text: "А сколько это стоит?",
    });
    expect(text(r)).toMatch(/Цены/);
    expect(text(r)).toMatch(/Подтвердить\?/);
  });

  it("кнопки справки в меню", async () => {
    const { bot } = setup();
    const r = await press(
      bot,
      1,
      await send(bot, 1, { type: "start" }),
      "Врачи",
    );
    expect(text(r)).toMatch(/Наши врачи \(вымышленные\)/);
  });
});

describe("понимание текста: подсказки проверяются по расписанию", () => {
  const fixed = (meaning: Interpretation): TextInterpreter => ({
    interpret: () => meaning,
  });
  function withInterpreter(interpreter: TextInterpreter) {
    const store = new SqliteStore(":memory:");
    const schedule = new ClinicSchedule(fictionalClinic, store, () => NOW);
    return {
      schedule,
      bot: createBot({
        clinic: fictionalClinic,
        schedule,
        sessions: store,
        interpreter,
        now: () => NOW,
      }),
    };
  }

  it("врач, день и свободное время → сразу подтверждение, но без записи", async () => {
    const { bot, schedule } = withInterpreter(
      fixed({
        intent: "book",
        doctorId: "testova",
        date: "2026-10-19",
        time: "10:30",
      }),
    );
    const r = await send(bot, 1, { type: "text", text: "к Тестовой на 10:30" });
    expect(text(r)).toMatch(/Проверьте запись/);
    expect(text(r)).toMatch(/10:30/);
    expect(schedule.listBookings(1)).toEqual([]);
  });

  it("занятое или несуществующее время → выбор времени", async () => {
    const { bot, schedule } = withInterpreter(
      fixed({
        intent: "book",
        doctorId: "testova",
        date: "2026-10-19",
        time: "10:15",
      }),
    );
    schedule.book(2, "testova", "2026-10-19", "10:00");
    const r = await send(bot, 1, { type: "text", text: "..." });
    expect(text(r)).toMatch(/Время 10:15 недоступно/);
    expect(text(r)).toMatch(/Выберите время/);
  });

  it("день без приёма → выбор дня; неизвестный врач → выбор направления", async () => {
    let r = await send(
      withInterpreter(
        fixed({ intent: "book", doctorId: "testova", date: "2026-10-20" }),
      ).bot,
      1,
      { type: "text", text: "..." },
    );
    expect(text(r)).toMatch(/на вт, 20 окт свободного времени нет/);
    r = await send(
      withInterpreter(fixed({ intent: "book", doctorId: "dr-house" })).bot,
      1,
      { type: "text", text: "..." },
    );
    expect(text(r)).toMatch(/Выберите направление/);
  });

  it("ответ модели показывается с кнопками; длинный — обрезается", async () => {
    const { bot } = withInterpreter(
      fixed({ intent: "question", answer: "Да, есть парковка. ".repeat(100) }),
    );
    const r = await send(bot, 1, { type: "text", text: "Есть парковка?" });
    expect(r[0].text.length).toBeLessThan(ANSWER_MAX + 100);
    expect(buttons(r).length).toBeGreaterThan(0);
  });
});

describe("после записи", () => {
  it("необязательные действия не влияют на подтверждённую запись", async () => {
    const { bot, schedule } = setup();
    const done = await press(bot, 1, await toConfirm(bot, 1), "Подтвердить");
    expect(text(done)).toMatch(/необязательно/);
    expect(buttons(done).map((b) => b.label)).toEqual([
      "Памятка к визиту",
      "Как добраться",
      "Мои записи",
      "В меню",
    ]);
    expect(schedule.listBookings(1)).toHaveLength(1);
    const tips = await press(bot, 1, done, "Памятка к визиту");
    expect(text(tips)).toMatch(/Приходите за 10 минут/);
    expect(text(tips)).not.toMatch(/анализ|жалоб|документы врачу/i);
    expect(schedule.listBookings(1)).toHaveLength(1);
  });
});

describe("передача администратору", () => {
  function withNotifier(fail = false) {
    const store = new SqliteStore(":memory:");
    let now = NOW;
    const notified: number[] = [];
    const errors: string[] = [];
    const schedule = new ClinicSchedule(fictionalClinic, store, () => now);
    const bot = createBot({
      clinic: fictionalClinic,
      schedule,
      sessions: store,
      interpreter: new RuleInterpreter(fictionalClinic),
      notifier: {
        notifyHandoff: async (peer) => {
          if (fail) throw new Error("vk down");
          notified.push(peer);
        },
      },
      handoffHours: 12,
      now: () => now,
      onError: (m) => errors.push(m),
    });
    return {
      bot,
      notified,
      errors,
      advance: (h: number) => (now = new Date(now.getTime() + h * 3_600_000)),
    };
  }

  it("администратор получает уведомление, бот молчит, пока его не вернут", async () => {
    const { bot, notified } = withNotifier();
    let r = await press(
      bot,
      1,
      await send(bot, 1, { type: "start" }),
      "Позвать администратора",
    );
    r = await press(bot, 1, r, "Да, позвать");
    expect(text(r)).toMatch(/Передал ваш запрос администратору/);
    expect(notified).toEqual([1]);
    expect(await send(bot, 1, { type: "text", text: "алло?" })).toEqual([]);
    const back = await press(bot, 1, r, "Вернуться к боту");
    expect(text(back)).toMatch(/Снова на связи бот/);
    expect(text(await send(bot, 1, { type: "text", text: "меню" }))).toMatch(
      /Чем могу помочь/,
    );
  });

  it("ответ администратора продлевает паузу; через 12 часов бот снова отвечает", async () => {
    const { bot, advance } = withNotifier();
    await send(bot, 1, { type: "action", payload: { a: "admin" } });
    await send(bot, 1, { type: "action", payload: { a: "hoff" } });
    advance(11);
    bot.notePeerHandledByAdmin(1);
    advance(11);
    expect(await send(bot, 1, { type: "text", text: "здравствуйте" })).toEqual(
      [],
    );
    advance(2);
    expect(
      text(await send(bot, 1, { type: "text", text: "здравствуйте" })),
    ).toMatch(/автоматический помощник/);
  });

  it("сбой уведомления не ломает ответ пациенту", async () => {
    const { bot, errors } = withNotifier(true);
    await send(bot, 1, { type: "action", payload: { a: "admin" } });
    const r = await send(bot, 1, { type: "action", payload: { a: "hoff" } });
    expect(text(r)).toMatch(/Передал ваш запрос/);
    expect(errors).toEqual(["handoff notification failed"]);
  });

  it("«Да, позвать» без шага подтверждения — устаревшая кнопка", async () => {
    const { bot, notified } = withNotifier();
    const r = await send(bot, 1, { type: "action", payload: { a: "hoff" } });
    expect(text(r)).toMatch(/кнопка устарела/);
    expect(notified).toEqual([]);
  });
});
