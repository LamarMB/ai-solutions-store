import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { handleAdminApi, type AdminApiDeps } from "@/admin/api";
import { AdminAuth, type AuthConfig } from "@/admin/auth";
import { hashPassword } from "@/admin/password";
import { AdminService } from "@/admin/service";
import { createDemoBot } from "@/bot";
import { draftTag } from "@/bot/dialog/dialog";
import type { Reply } from "@/bot/dialog/types";
import type { StaffRole } from "@/bot/storage/admin-store";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import { SCHEMA_VERSION, SqliteStore } from "@/bot/storage/sqlite";

/*
 * Этапы 3 и 5: меню из трёх действий и обращение к администратору с явным
 * согласием на передачу показанного текста. Только вымышленные данные.
 */

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const HOST = "clinic.example";
const ORIGIN = `https://${HOST}`;
const PASSWORD = "надёжный-пароль-2026";
const PEER = 7;
const OTHER = 8;
const KEY = MedicalCipher.generateKey();
const config: AuthConfig = { secureCookie: true, allowedOrigins: [] };
const REQUEST = "Хочу перенести запись к ортопеду на пятницу после 16:00";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "requests-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "bot.sqlite");
}

const text = (replies: Reply[]) => replies.map((r) => r.text).join("\n");
const labels = (replies: Reply[]) =>
  replies.flatMap((r) => r.buttons.flat()).map((b) => b.label);

async function setup({
  cipher = true,
  miniApp = true,
}: { cipher?: boolean; miniApp?: boolean } = {}) {
  const path = tempDb();
  let now = NOW;
  const clock = () => now;
  const notices: { peerId: number; requestId?: number }[] = [];
  const logs: string[] = [];
  const { bot, store } = createDemoBot({
    dbPath: path,
    now: clock,
    cipher: cipher ? MedicalCipher.fromBase64(KEY) : undefined,
    miniApp,
    notifier: {
      notifyHandoff: async (peerId, requestId) =>
        void notices.push({ peerId, requestId }),
    },
    log: (m) => logs.push(m),
  });
  const panelStore = new SqliteStore(path, {
    cipher: cipher ? MedicalCipher.fromBase64(KEY) : undefined,
  });
  cleanups.push(() => {
    store.close();
    panelStore.close();
  });
  const hash = await hashPassword(PASSWORD);
  const users: [string, StaffRole, string | null][] = [
    ["owner", "owner", null],
    ["admin", "admin", null],
    ["dr-maketov", "doctor", "maketov"],
  ];
  for (const [login, role, doctorId] of users)
    panelStore.admin.createUser(login, hash, NOW.toISOString(), role, doctorId);
  const deps: AdminApiDeps = {
    service: new AdminService(panelStore, clock),
    auth: new AdminAuth(panelStore.admin, clock),
    config,
    clientKey: () => "client-1",
    log: (m) => logs.push(m),
  };
  const as = async (login: string) => {
    const r = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/login`, {
        method: "POST",
        headers: {
          host: HOST,
          origin: ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ login, password: PASSWORD }),
      }),
      ["login"],
      deps,
    );
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    return async (method: string, route: string, body?: unknown) => {
      const url = new URL(`${ORIGIN}/api/admin/${route}`);
      const response = await handleAdminApi(
        new Request(url, {
          method,
          headers: {
            host: HOST,
            cookie,
            ...(method !== "GET" ? { origin: ORIGIN } : {}),
            ...(body !== undefined
              ? { "content-type": "application/json" }
              : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
        url.pathname.replace("/api/admin/", "").split("/").filter(Boolean),
        deps,
      );
      const json = (await response.json()) as {
        ok: boolean;
        data?: unknown;
        error?: string;
      };
      return { status: response.status, json, text: JSON.stringify(json) };
    };
  };
  const say = (t: string, peer = PEER) =>
    bot.handle(peer, { type: "text", text: t });
  const act = (payload: unknown, peer = PEER) =>
    bot.handle(peer, { type: "action", payload });
  const press = async (last: Reply[], label: string, peer = PEER) => {
    const button = last
      .flatMap((r) => r.buttons.flat())
      .find((b) => b.label === label);
    if (!button)
      throw new Error(`Нет кнопки «${label}»: ${labels(last).join(", ")}`);
    return act(button.action, peer);
  };
  /** Пациент: «Администратор» → текст → предпросмотр. */
  const compose = async (request = REQUEST, peer = PEER) => {
    const menu = await bot.handle(peer, { type: "start" });
    const ask = await press(menu, "Администратор", peer);
    expect(text(ask)).toMatch(/Напишите одним сообщением/);
    return say(request, peer);
  };
  return {
    path,
    bot,
    store,
    panelStore,
    notices,
    logs,
    as,
    say,
    act,
    press,
    compose,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

describe("главное меню и ИИ в переписке", () => {
  it("три действия: «Открыть приложение», «Мои записи», «Администратор»", async () => {
    const t = await setup();
    const start = await t.bot.handle(PEER, { type: "start" });
    expect(start[0].buttons.map((row) => row.map((b) => b.label))).toEqual([
      ["Открыть приложение"],
      ["Мои записи", "Администратор"],
    ]);
    expect(start[0].buttons[0][0].action).toEqual({ a: "app" });
    expect(text(start)).toMatch(
      /«Открыть приложение» — врачи, цены и запись на приём/,
    );
    // Предупреждение о видимости переписки сохранено.
    expect(text(start)).toMatch(/администраторы сообщества ВКонтакте/);
  });

  it("«Мои записи» показывают записи и подсказывают перенос в приложении", async () => {
    const t = await setup();
    const id = t.store.insert({
      peerId: PEER,
      doctorId: "testova",
      date: "2026-10-21",
      time: "09:00",
      createdAt: NOW.toISOString(),
    });
    expect(id.status).toBe("ok");
    const r = await t.press(
      await t.bot.handle(PEER, { type: "start" }),
      "Мои записи",
    );
    expect(text(r)).toMatch(
      /Ваши записи:\n№\d+: .*21 окт.*09:00 — Анна Тестова/,
    );
    expect(text(r)).toMatch(/Перенести время можно в приложении/);
    expect(labels(r)).toContain("Открыть приложение");
  });

  it("текстовые просьбы работают без кнопок", async () => {
    const t = await setup();
    t.store.insert({
      peerId: PEER,
      doctorId: "maketov",
      date: "2026-10-23",
      time: "14:00",
      createdAt: NOW.toISOString(),
    });
    expect(text(await t.say("Хочу записаться к терапевту"))).toMatch(
      /Анна Тестова|Павел Примеров/,
    );
    expect(text(await t.say("Какие врачи есть?"))).toMatch(/Наши врачи/);
    expect(text(await t.say("Сколько стоит приём?"))).toMatch(/₽/);
    expect(text(await t.say("Где находится клиника?"))).toMatch(/Вымышленная/);
    const move = await t.say("Перенеси мою запись");
    expect(text(move)).toMatch(/Ваши записи/);
    expect(text(move)).toMatch(/Перенести время можно в приложении/);
    expect(text(await t.say("Позови администратора"))).toMatch(
      /Напишите одним сообщением/,
    );
  });

  it("кнопка приложения в симуляторе или у старого клиента ведёт к записи через бота", async () => {
    const t = await setup();
    const r = await t.act({ a: "app" });
    expect(text(r)).toMatch(/Выберите направление/);
  });

  it("без Mini App главная кнопка — «Записаться на приём»", async () => {
    const t = await setup({ miniApp: false });
    const start = await t.bot.handle(PEER, { type: "start" });
    expect(start[0].buttons[0][0]).toMatchObject({
      label: "Записаться на приём",
      action: { a: "book" },
    });
  });
});

describe("обращение к администратору: предпросмотр и согласие", () => {
  it("показывается точный текст; после «Разрешаю передачу» сотрудник видит только его", async () => {
    const t = await setup();
    // До обращения пациент обсуждал жалобу — она не должна попасть к сотруднику.
    await t.say("у меня болит колено");
    const preview = await t.compose();
    expect(text(preview)).toContain(`«${REQUEST}»`);
    expect(text(preview)).toMatch(/дословно, как вы написали/);
    expect(text(preview)).toMatch(
      /администраторы сообщества ВКонтакте видят и без него/,
    );
    expect(labels(preview)).toEqual([
      "Разрешаю передачу",
      "Не разрешаю",
      "Изменить текст",
    ]);
    // До согласия обращения нет.
    expect(t.panelStore.requests.countActive(NOW.toISOString())).toBe(0);

    const done = await t.press(preview, "Разрешаю передачу");
    expect(text(done)).toMatch(/Передал администратору клиники обращение №1/);
    expect(t.notices).toEqual([{ peerId: PEER, requestId: 1 }]);

    const admin = await t.as("admin");
    const list = await admin("GET", "requests");
    expect(list.status).toBe(200);
    // В списке нет содержания и полного VK ID.
    expect(list.text).not.toContain("ортопед");
    expect(list.text).not.toContain(`"peerId"`);
    const content = await admin("GET", "requests/1/content");
    expect(content.json.data).toMatchObject({ id: 1, text: REQUEST });
    expect(content.text).not.toMatch(/колен/);
    expect(t.panelStore.requests.listAccessLog()[0]).toMatchObject({
      login: "admin",
      requestId: 1,
      action: "read",
      result: "granted",
    });
  });

  it("суть в той же просьбе — предпросмотр сразу; контакты убираются и это видно", async () => {
    const t = await setup();
    const r = await t.say(
      "Позовите администратора, хочу перенести запись, мой телефон +7 900 000-00-00",
    );
    expect(text(r)).toMatch(
      /Передать администратору клиники через нашу систему/,
    );
    expect(text(r)).not.toContain("900 000");
    expect(text(r)).toMatch(/Телефоны и адреса почты из текста убраны/);
  });

  it("отказ: ничего не передаётся, можно позвать администратора без описания", async () => {
    const t = await setup();
    const preview = await t.compose();
    const no = await t.press(preview, "Не разрешаю");
    expect(text(no)).toMatch(/через нашу систему этот текст не передаём/);
    expect(t.panelStore.requests.countActive(NOW.toISOString())).toBe(0);
    // После отказа старая кнопка согласия не работает.
    const late = await t.press(preview, "Разрешаю передачу");
    expect(text(late)).toMatch(/устарела/);
    expect(t.panelStore.requests.list(NOW.toISOString())).toHaveLength(0);
    // Человек доступен и без передачи текста.
    const call = await t.press(no, "Да, позвать");
    expect(text(call)).toMatch(/никакой текст не передавался/);
    expect(t.notices).toEqual([{ peerId: PEER, requestId: undefined }]);
  });

  it("согласие нельзя обойти: без шага, другим текстом, словом «да», чужой меткой", async () => {
    const t = await setup();
    // Нажатие без предпросмотра.
    expect(text(await t.act({ a: "hok", h: draftTag(REQUEST) }))).toMatch(
      /устарела/,
    );
    const preview = await t.compose();
    // «Да» — не согласие.
    await t.say("да");
    // Подделанная метка другого текста.
    expect(
      text(await t.act({ a: "hok", h: draftTag("другой текст") })),
    ).toMatch(/устарела/);
    // Без метки — неверная кнопка.
    await t.act({ a: "hok" });
    expect(t.panelStore.requests.list(NOW.toISOString())).toHaveLength(0);
    // Изменили текст — кнопка старого предпросмотра больше не согласие.
    const edit = await t.press(preview, "Изменить текст");
    const second = await t.say("Нужна справка для работы");
    expect(text(await t.press(preview, "Разрешаю передачу"))).toMatch(
      /устарела/,
    );
    expect(t.panelStore.requests.list(NOW.toISOString())).toHaveLength(0);
    expect(text(edit)).toMatch(/Напишите одним сообщением/);
    await t.press(second, "Разрешаю передачу");
    const admin = await t.as("admin");
    expect((await admin("GET", "requests/1/content")).json.data).toMatchObject({
      text: "Нужна справка для работы",
    });
  });

  it("повторное нажатие не создаёт дубликатов", async () => {
    const t = await setup();
    const preview = await t.compose();
    await Promise.all([
      t.press(preview, "Разрешаю передачу"),
      t.press(preview, "Разрешаю передачу"),
    ]);
    await t.press(preview, "Разрешаю передачу");
    expect(t.panelStore.requests.list(NOW.toISOString())).toHaveLength(1);
    // Повтор на уровне хранилища (например, гонка двух процессов) — то же обращение.
    const again = t.panelStore.requests.create(
      PEER,
      REQUEST,
      NOW.toISOString(),
    );
    expect(again).toEqual({ id: 1, repeated: true });
  });

  it("текст после согласия изменить нельзя (база отклоняет, подмена не показывается)", async () => {
    const t = await setup();
    await t.press(await t.compose(), "Разрешаю передачу");
    const raw = new DatabaseSync(t.path);
    cleanups.push(() => raw.close());
    expect(() =>
      raw
        .prepare("UPDATE patient_requests SET text_sha256 = 'x' WHERE id = 1")
        .run(),
    ).toThrow(/immutable/);
    const other = MedicalCipher.fromBase64(KEY).encrypt("подмена", "request:1");
    expect(() =>
      raw
        .prepare("UPDATE patient_requests SET payload = ? WHERE id = 1")
        .run(other),
    ).toThrow(/immutable/);
    // Даже если обойти триггеры, подмена не пройдёт проверку SHA-256.
    raw.exec("DROP TRIGGER patient_requests_payload_once");
    raw
      .prepare("UPDATE patient_requests SET payload = ? WHERE id = 1")
      .run(other);
    const admin = await t.as("admin");
    const r = await admin("GET", "requests/1/content");
    expect(r.status).toBe(410);
    expect(r.text).not.toContain("подмена");
  });

  it("на шаге текста тревожные признаки — сразу экстренный ответ, без обращения", async () => {
    const t = await setup();
    const menu = await t.bot.handle(PEER, { type: "start" });
    await t.press(menu, "Администратор");
    const r = await t.say("сильная боль в груди и тяжело дышать");
    expect(text(r)).toMatch(/103|112/);
    expect(t.panelStore.requests.list(NOW.toISOString())).toHaveLength(0);
  });

  it("без ключа шифрования — прежний сценарий без передачи текста", async () => {
    const t = await setup({ cipher: false });
    const menu = await t.bot.handle(PEER, { type: "start" });
    const r = await t.press(menu, "Администратор");
    expect(text(r)).toMatch(/Позвать администратора клиники\?/);
    expect(labels(r)).not.toContain("Разрешаю передачу");
  });
});

describe("отзыв согласия", () => {
  it("кнопкой — даже пока бот молчит из-за администратора; доступ в панели закрыт", async () => {
    const t = await setup();
    const done = await t.press(await t.compose(), "Разрешаю передачу");
    const admin = await t.as("admin");
    expect((await admin("GET", "requests/1/content")).status).toBe(200);
    // Бот на паузе (отвечает администратор), но отзыв работает.
    expect(await t.say("алло?")).toEqual([]);
    const revoked = await t.press(done, "Отозвать передачу №1");
    expect(text(revoked)).toMatch(/отозвана: текст удалён из панели клиники/);
    expect(text(revoked)).toMatch(/уже прочитал его, это не отменить/);
    // Пауза сохраняется.
    expect(t.bot.isPaused(PEER)).toBe(true);
    const r = await admin("GET", "requests/1/content");
    expect(r.status).toBe(410);
    expect(r.json.error).toMatch(/отозвал согласие/);
    const list = (await admin("GET", "requests")).json.data as {
      requests: { consent: string; available: boolean }[];
    };
    expect(list.requests[0]).toMatchObject({
      consent: "revoked",
      available: false,
    });
    const raw = new DatabaseSync(t.path);
    cleanups.push(() => raw.close());
    expect(
      raw.prepare("SELECT payload FROM patient_requests WHERE id = 1").get(),
    ).toEqual({ payload: null });
  });

  it("командой «отозвать передачу»; чужое обращение отозвать нельзя", async () => {
    const t = await setup();
    await t.press(await t.compose(REQUEST, OTHER), "Разрешаю передачу", OTHER);
    // Пациент PEER пытается отозвать обращение №1 пациента OTHER.
    const r = await t.act({ a: "hrv", r: 1 });
    expect(text(r)).toMatch(/Действующей передачи по этому обращению нет/);
    expect(t.panelStore.requests.countActive(NOW.toISOString())).toBe(1);
    const own = await t.say("отозвать передачу", OTHER);
    expect(text(own)).toMatch(/№1 отозвана/);
    expect(t.panelStore.requests.countActive(NOW.toISOString())).toBe(0);
  });

  it("истёкшие обращения удаляются", async () => {
    const t = await setup();
    await t.press(await t.compose(), "Разрешаю передачу");
    const later = new Date(NOW.getTime() + 31 * 86_400_000).toISOString();
    expect(t.panelStore.requests.purgeExpired(later)).toBe(1);
    expect(t.panelStore.requests.read(1, later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("панель: «Обращения» только для роли admin", () => {
  it("владелец и врач не видят обращений; журнал у владельца — без содержания", async () => {
    const t = await setup();
    await t.press(await t.compose(), "Разрешаю передачу");
    for (const login of ["owner", "dr-maketov"]) {
      const call = await t.as(login);
      expect((await call("GET", "requests")).status).toBe(403);
      expect((await call("GET", "requests/1/content")).status).toBe(403);
      expect(
        (await call("PATCH", "requests/1", { action: "done" })).status,
      ).toBe(403);
    }
    const admin = await t.as("admin");
    await admin("GET", "requests/1/content");
    const owner = await t.as("owner");
    const log = await owner("GET", "medical-log");
    expect(log.text).toMatch(/"requestId":1/);
    expect(log.text).not.toContain("ортопед");
  });

  it("«Обработано»: статус меняется, текст хранится не дольше 7 дней", async () => {
    const t = await setup();
    await t.press(await t.compose(), "Разрешаю передачу");
    const admin = await t.as("admin");
    const r = await admin("PATCH", "requests/1", { action: "done" });
    expect(r.json.data).toMatchObject({ status: "done", doneBy: "admin" });
    expect(
      (await admin("PATCH", "requests/99", { action: "done" })).status,
    ).toBe(404);
    expect(
      (await admin("PATCH", "requests/1", { action: "delete" })).status,
    ).toBe(400);
    const later = new Date(NOW.getTime() + 8 * 86_400_000).toISOString();
    expect(t.panelStore.requests.purgeExpired(later)).toBe(1);
  });

  it("журналы, уведомления и аудит — без текста обращения", async () => {
    const t = await setup();
    await t.press(await t.compose(), "Разрешаю передачу");
    const admin = await t.as("admin");
    await admin("GET", "requests/1/content");
    await admin("PATCH", "requests/1", { action: "done" });
    const everything = JSON.stringify({
      logs: t.logs,
      notices: t.notices,
      audit: t.panelStore.admin.listAudit(500),
      access: t.panelStore.requests.listAccessLog(500),
      stats: t.panelStore.readStats("2026-01-01"),
    });
    expect(everything).not.toMatch(/ортопед|пятниц/);
  });
});

describe("миграция v6 → v7", () => {
  it("записи, сотрудники и согласия сохраняются; появляются таблицы обращений", async () => {
    const path = tempDb();
    const hash = await hashPassword(PASSWORD);
    const fresh = new SqliteStore(path);
    fresh.admin.createUser("vps-owner", hash, NOW.toISOString(), "owner");
    fresh.insert({
      peerId: PEER,
      doctorId: "maketov",
      date: "2026-10-20",
      time: "09:00",
      createdAt: NOW.toISOString(),
    });
    fresh.close();
    const db = new DatabaseSync(path);
    db.exec(`
      DROP TABLE patient_requests;
      DROP TABLE request_access_log;
      PRAGMA user_version = 6;
    `);
    db.close();

    const store = new SqliteStore(path, {
      cipher: MedicalCipher.fromBase64(KEY),
    });
    cleanups.push(() => store.close());
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
    expect(store.schemaVersion).toBe(SCHEMA_VERSION);
    expect(store.searchBookings({})).toHaveLength(1);
    expect(store.admin.findUser("vps-owner")).toMatchObject({
      role: "owner",
      passwordHash: hash,
    });
    expect(store.requests.create(PEER, REQUEST, NOW.toISOString())).toEqual({
      id: 1,
      repeated: false,
    });
  });
});
