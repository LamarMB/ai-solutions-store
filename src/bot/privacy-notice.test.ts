import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoBot } from "@/bot";
import { EMERGENCY_TEXT } from "@/bot/conversation/safety";
import { OUT_OF_SCOPE_TEXT } from "@/bot/conversation/scope";
import { PRIVACY_NOTICE } from "@/bot/dialog/dialog";
import type { Reply } from "@/bot/dialog/types";
import { MedicalCipher } from "@/bot/storage/medical-crypto";

/*
 * Предупреждение о том, кто видит переписку во ВКонтакте: один раз в начале
 * разговора — и по «Начать», и когда пациент сразу пишет текст. Только
 * вымышленные клиника и VK ID.
 */

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const PEER = 3001;
const HOUR = 3_600_000;

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const text = (replies: Reply[]) => replies.map((r) => r.text).join("\n");
const labels = (replies: Reply[]) =>
  replies.flatMap((r) => r.buttons.flat()).map((b) => b.label);
const notices = (replies: Reply[]) =>
  text(replies).split(PRIVACY_NOTICE).length - 1;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "notice-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  let now = NOW;
  const handoffs: { peerId: number; requestId?: number }[] = [];
  const { bot, store } = createDemoBot({
    dbPath: join(dir, "bot.sqlite"),
    now: () => now,
    cipher: MedicalCipher.fromBase64(MedicalCipher.generateKey()),
    miniApp: true,
    notifier: {
      notifyHandoff: async (peerId, requestId) =>
        void handoffs.push({ peerId, requestId }),
    },
  });
  cleanups.push(() => store.close());
  const say = (t: string, peer = PEER) =>
    bot.handle(peer, { type: "text", text: t });
  const press = async (last: Reply[], label: string, peer = PEER) => {
    const button = last
      .flatMap((r) => r.buttons.flat())
      .find((b) => b.label === label);
    if (!button)
      throw new Error(`Нет кнопки «${label}»: ${labels(last).join(", ")}`);
    return bot.handle(peer, { type: "action", payload: button.action });
  };
  return {
    bot,
    store,
    handoffs,
    say,
    press,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

describe("текст предупреждения", () => {
  it("честно: переписка не закрытая, её читают руководители сообщества клиники", () => {
    expect(PRIVACY_NOTICE).toMatch(/не закрытая/);
    expect(PRIVACY_NOTICE).toMatch(
      /руководители сообщества клиники во ВКонтакте/,
    );
    expect(PRIVACY_NOTICE).toMatch(/доступ к сообщениям/);
    expect(PRIVACY_NOTICE).not.toMatch(/конфиденциальн|скрыт|защищен|никто/i);
  });
});

describe("первое сообщение", () => {
  it("через «Начать» — приветствие с предупреждением, один раз", async () => {
    const t = setup();
    const r = await t.bot.handle(PEER, { type: "start" });
    expect(text(r)).toMatch(/Я помощник клиники/);
    expect(notices(r)).toBe(1);
    expect(labels(r)).toEqual([
      "Открыть приложение",
      "Мои записи",
      "Администратор",
    ]);
  });

  it("без «Начать», сразу вопрос — предупреждение перед ответом, ответ и кнопки на месте", async () => {
    const t = setup();
    const r = await t.say("Сколько стоит приём терапевта?");
    expect(r[0].text.startsWith(PRIVACY_NOTICE)).toBe(true);
    expect(notices(r)).toBe(1);
    expect(text(r)).toMatch(/Приём терапевта — 2 000 ₽/);
    expect(labels(r)).toEqual([
      "Открыть приложение",
      "Мои записи",
      "Администратор",
    ]);
  });

  it("без «Начать», сразу жалоба — предупреждение до уточняющих вопросов", async () => {
    const t = setup();
    const r = await t.say("Болит колено, хочу к врачу");
    expect(r[0].text.startsWith(PRIVACY_NOTICE)).toBe(true);
    expect(notices(r)).toBe(1);
  });

  it("«Здравствуйте» — одно предупреждение, не два", async () => {
    const t = setup();
    const r = await t.say("Здравствуйте");
    expect(text(r)).toMatch(/Я помощник клиники/);
    expect(notices(r)).toBe(1);
  });

  it("первым пришло нажатие старой кнопки — предупреждение, кнопки ответа сохранены", async () => {
    const t = setup();
    const r = await t.bot.handle(PEER, {
      type: "action",
      payload: { a: "menu" },
    });
    expect(notices(r)).toBe(1);
    expect(labels(r)).toContain("Мои записи");
  });

  it("экстренный ответ первым — 103/112 идут раньше предупреждения", async () => {
    const t = setup();
    const r = await t.say("Сильная боль в груди и тяжело дышать");
    expect(r[0].text.startsWith(EMERGENCY_TEXT)).toBe(true);
    expect(r[0].text.indexOf(PRIVACY_NOTICE)).toBeGreaterThan(
      r[0].text.indexOf("103"),
    );
    expect(labels(r)).toContain("Позвать администратора");
  });

  it("оффтоп первым — шаблон отказа целиком, предупреждение перед ним", async () => {
    const t = setup();
    const r = await t.say("Расскажи анекдот");
    expect(r[0].text).toBe(`${PRIVACY_NOTICE}\n\n${OUT_OF_SCOPE_TEXT}`);
  });
});

describe("повторное обращение и отсутствие повторов", () => {
  it("в одном разговоре — только один раз, за всю запись на приём", async () => {
    const t = setup();
    const all: Reply[] = [];
    let r = await t.say("Хочу записаться к терапевту");
    all.push(...r);
    r = await t.press(r, "Анна Тестова");
    all.push(...r);
    r = await t.press(r, "ср, 21 окт");
    all.push(...r);
    r = await t.press(r, "10:00");
    all.push(...r);
    r = await t.press(r, "Подтвердить");
    all.push(...r);
    expect(text(r)).toMatch(/Запись №\d+ подтверждена/);
    r = await t.say("Где находится клиника?");
    all.push(...r);
    expect(notices(all)).toBe(1);
    expect(all[0].text.startsWith(PRIVACY_NOTICE)).toBe(true);
  });

  it("на следующий день в пределах срока хранения — без повтора", async () => {
    const t = setup();
    await t.say("Сколько стоит приём терапевта?");
    t.advance(20 * HOUR);
    const r = await t.say("Какие врачи есть?");
    expect(notices(r)).toBe(0);
    expect(text(r)).toMatch(/Анна Тестова — Терапевт/);
  });

  it("новый разговор после срока хранения истории — предупреждение снова", async () => {
    const t = setup();
    await t.say("Сколько стоит приём терапевта?");
    t.advance(25 * HOUR);
    const r = await t.say("Какие врачи есть?");
    expect(notices(r)).toBe(1);
    expect(text(r)).toMatch(/Анна Тестова — Терапевт/);
  });

  it("у каждого пациента — своё первое сообщение", async () => {
    const t = setup();
    await t.say("Сколько стоит приём терапевта?");
    const other = await t.say("Сколько стоит приём терапевта?", PEER + 1);
    expect(notices(other)).toBe(1);
    const again = await t.say("Где находится клиника?");
    expect(notices(again)).toBe(0);
  });
});

describe("передача обращения администратору", () => {
  it("первым сообщением просьба позвать администратора — один честный текст, согласие работает", async () => {
    const t = setup();
    const preview = await t.say(
      "Позовите администратора, хочу уточнить, можно ли прийти с ребёнком",
    );
    // В предпросмотре уже сказано, кто видит переписку, — общее предупреждение не дублируется.
    expect(notices(preview)).toBe(0);
    expect(text(preview)).toMatch(
      /администратор и другие руководители сообщества клиники во ВКонтакте видят и без него/,
    );
    expect(text(preview)).toMatch(/только сотрудники с ролью «Администратор»/);
    expect(t.store.requests.countActive(NOW.toISOString())).toBe(0);

    const done = await t.press(preview, "Разрешаю передачу");
    expect(text(done)).toMatch(
      /Передал в панель клиники обращение №1 — только показанный текст/,
    );
    expect(text(done)).toMatch(/увидит его переписку/);
    expect(t.store.requests.countActive(NOW.toISOString())).toBe(1);
    expect(t.handoffs).toEqual([{ peerId: PEER, requestId: 1 }]);
  });

  it("отказ от передачи: в панель ничего не попадает, уведомления нет", async () => {
    const t = setup();
    let r = await t.bot.handle(PEER, { type: "start" });
    r = await t.press(r, "Администратор");
    expect(text(r)).toMatch(
      /администратор, который вам ответит, и другие руководители сообщества/,
    );
    r = await t.say("Можно ли прийти на приём с ребёнком?");
    r = await t.press(r, "Не разрешаю");
    expect(text(r)).toMatch(/через нашу систему этот текст не передаём/);
    expect(t.store.requests.countActive(NOW.toISOString())).toBe(0);
    expect(t.handoffs).toEqual([]);
  });

  it("пока отвечает администратор, бот молчит и не добавляет предупреждений", async () => {
    const t = setup();
    const preview = await t.say(
      "Позовите администратора, хочу уточнить про парковку у клиники",
    );
    await t.press(preview, "Разрешаю передачу");
    expect(await t.say("Спасибо, жду")).toEqual([]);
  });
});
