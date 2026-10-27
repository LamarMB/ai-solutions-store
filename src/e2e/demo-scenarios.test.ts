import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { handleAdminApi, type AdminApiDeps } from "@/admin/api";
import { AdminAuth, type AuthConfig } from "@/admin/auth";
import { hashPassword } from "@/admin/password";
import { AdminService } from "@/admin/service";
import { createDemoBot } from "@/bot";
import type { Reply } from "@/bot/dialog/types";
import type { StaffRole } from "@/bot/storage/admin-store";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import { SqliteStore } from "@/bot/storage/sqlite";
import { handleMiniAppApi, LAUNCH_HEADER } from "@/miniapp/api";
import type { MiniAppConfig } from "@/miniapp/config";
import { signLaunchParams } from "@/miniapp/launch-params";
import { MiniAppService } from "@/miniapp/service";

/*
 * Сквозные сценарии живой демонстрации «Демо-Мед»: бот (режим правил, без
 * OpenAI и ВКонтакте), VK Mini App и API панели работают с ОДНОЙ базой SQLite,
 * как на сервере. Только вымышленная клиника, сотрудники и VK ID.
 */

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const HOST = "clinic.example";
const ORIGIN = `https://${HOST}`;
const PASSWORD = "демо-пароль-не-настоящий-2026";
const KEY = MedicalCipher.generateKey();
const APP_ID = 51000001;
const SECRET = "test-secret-not-real-e2e";
const ANNA = 2001; // пациентка в боте и Mini App
const BORIS = 2002; // второй пациент
const authConfig: AuthConfig = { secureCookie: true, allowedOrigins: [] };
const miniConfig: MiniAppConfig = {
  appId: APP_ID,
  secret: SECRET,
  allowedUserIds: new Set([ANNA, BORIS]),
  groupId: 242364009,
  maxAgeSeconds: 24 * 3600,
};

// Справочники клиники отбрасывают прошедшие исключения по системным часам,
// поэтому системная дата совпадает с часами сценария (как в admin.test.ts).
beforeAll(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));
afterAll(() => vi.useRealTimers());

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const text = (replies: Reply[]) => replies.map((r) => r.text).join("\n");
const labels = (replies: Reply[]) =>
  replies.flatMap((r) => r.buttons.flat()).map((b) => b.label);

type Json = { ok: boolean; data?: unknown; error?: string };

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "demo-e2e-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "bot.sqlite");
  let now = NOW;
  const clock = () => now;
  const notices: { peerId: number; requestId?: number }[] = [];
  const logs: string[] = [];
  const cipher = () => MedicalCipher.fromBase64(KEY);

  // Три процесса, как на сервере: бот, панель и Mini App — свои подключения.
  const { bot, store: botStore } = createDemoBot({
    dbPath: path,
    now: clock,
    cipher: cipher(),
    miniApp: true,
    notifier: {
      notifyHandoff: async (peerId, requestId) =>
        void notices.push({ peerId, requestId }),
    },
    log: (m) => logs.push(m),
  });
  const panelStore = new SqliteStore(path, { cipher: cipher() });
  const miniStore = new SqliteStore(path);
  cleanups.push(() => {
    botStore.close();
    panelStore.close();
    miniStore.close();
  });

  const hash = await hashPassword(PASSWORD);
  const users: [string, StaffRole, string | null][] = [
    ["owner", "owner", null],
    ["admin", "admin", null],
    ["dr-testova", "doctor", "testova"],
  ];
  for (const [login, role, doctorId] of users)
    panelStore.admin.createUser(login, hash, NOW.toISOString(), role, doctorId);
  const adminDeps: AdminApiDeps = {
    service: new AdminService(panelStore, clock),
    auth: new AdminAuth(panelStore.admin, clock),
    config: authConfig,
    clientKey: () => "client-1",
    log: (m) => logs.push(m),
  };
  const staff = async (login: string) => {
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
      adminDeps,
    );
    expect(r.status).toBe(200);
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
        adminDeps,
      );
      const json = (await response.json()) as Json;
      return { status: response.status, json, text: JSON.stringify(json) };
    };
  };

  const miniDeps = {
    service: new MiniAppService(miniStore, clock),
    config: miniConfig,
    now: clock,
  };
  const launch = (userId: number) => {
    const params: Record<string, string> = {
      vk_app_id: String(APP_ID),
      vk_is_app_user: "1",
      vk_language: "ru",
      vk_platform: "mobile_android",
      vk_ts: String(Math.floor(clock().getTime() / 1000) - 60),
      vk_user_id: String(userId),
    };
    const sign = signLaunchParams(params, SECRET);
    return new URLSearchParams({ ...params, sign }).toString();
  };
  const app =
    (userId: number) =>
    async (method: string, route: string, body?: unknown) => {
      const url = new URL(`${ORIGIN}/api/miniapp/${route}`);
      const response = await handleMiniAppApi(
        new Request(url, {
          method,
          headers: {
            [LAUNCH_HEADER]: launch(userId),
            ...(body !== undefined
              ? { "content-type": "application/json" }
              : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
        url.pathname.replace("/api/miniapp/", "").split("/").filter(Boolean),
        miniDeps,
      );
      const json = (await response.json()) as Json;
      return { status: response.status, json, text: JSON.stringify(json) };
    };

  const say = (t: string, peer = ANNA) =>
    bot.handle(peer, { type: "text", text: t });
  const press = async (last: Reply[], label: string, peer = ANNA) => {
    const button = last
      .flatMap((r) => r.buttons.flat())
      .find((b) => b.label === label);
    if (!button)
      throw new Error(`Нет кнопки «${label}»: ${labels(last).join(", ")}`);
    return bot.handle(peer, { type: "action", payload: button.action });
  };
  /** Запись в боте текстом и кнопками: терапевт → Анна Тестова → день → время. */
  const toConfirm = async (day: string, time: string, peer = ANNA) => {
    let r = await say("Хочу записаться к терапевту", peer);
    r = await press(r, "Анна Тестова", peer);
    r = await press(r, day, peer);
    return press(r, time, peer);
  };
  const freeSlots = async (date: string, userId = ANNA) =>
    (await app(userId)("GET", `doctors/testova/slots?date=${date}`)).json
      .data as string[];

  return {
    bot,
    panelStore,
    notices,
    logs,
    staff,
    app,
    say,
    press,
    toConfirm,
    freeSlots,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const WED = "2026-10-21";
const WED_LABEL = "ср, 21 окт";

describe("живая демонстрация: 12 сценариев на одной базе", () => {
  it("1–2. первое сообщение и вопросы о клинике", async () => {
    const t = await setup();
    // Новый диалог во ВКонтакте начинается кнопкой «Начать» (command: start).
    const first = await t.bot.handle(ANNA, { type: "start" });
    expect(text(first)).toMatch(/Я помощник клиники/);
    expect(text(first)).toMatch(/Диагнозы не ставлю/);
    expect(text(first)).toMatch(/могут читать руководители сообщества/);
    const price = await t.say("Сколько стоит приём терапевта?");
    expect(text(price)).toMatch(/Приём терапевта — 2 000 ₽/);
    expect(labels(price)).toEqual([
      "Открыть приложение",
      "Мои записи",
      "Администратор",
    ]);

    const where = await t.say("Где находится клиника и как работаете?");
    expect(text(where)).toMatch(/Адрес: .*ул\. Вымышленная/);
    expect(text(where)).toMatch(/Режим работы/);
    const doctors = await t.say("Какие врачи есть?");
    expect(text(doctors)).toMatch(/Анна Тестова — Терапевт/);
    expect(text(doctors)).toMatch(/Игорь Макетов — Травматолог-ортопед/);
  });

  it("3–5. запись в боте видна в панели и в Mini App", async () => {
    const t = await setup();
    const confirm = await t.toConfirm(WED_LABEL, "10:00");
    expect(text(confirm)).toMatch(/Проверьте запись/);
    expect(text(confirm)).toMatch(/Анна Тестова \(Терапевт\)/);
    const done = await t.press(confirm, "Подтвердить");
    expect(text(done)).toMatch(/Запись №\d+ подтверждена/);

    const admin = await t.staff("admin");
    const list = (await admin("GET", `bookings?from=${WED}&to=${WED}`)).json
      .data as { id: number; time: string; source: string; status: string }[];
    expect(list).toEqual([
      expect.objectContaining({
        time: "10:00",
        source: "vk",
        status: "confirmed",
      }),
    ]);
    // Та же запись — в «Моих записях» приложения у той же пациентки.
    const mine = (await t.app(ANNA)("GET", "bookings")).json.data as {
      upcoming: { id: number; time: string }[];
    };
    expect(mine.upcoming).toEqual([
      expect.objectContaining({ id: list[0].id, time: "10:00" }),
    ]);
    // Врач видит запись в «Моих приёмах», без медицинских сведений.
    const doctor = await t.staff("dr-testova");
    const own = await doctor("GET", "my/bookings");
    expect(own.status).toBe(200);
    expect(own.text).toContain("10:00");
  });

  it("6–8. занятое время недоступно другим; после отмены освобождается", async () => {
    const t = await setup();
    await t.press(await t.toConfirm(WED_LABEL, "10:00"), "Подтвердить");

    // Второй пациент: ни в Mini App, ни в боте, ни в панели 10:00 не предлагается.
    expect(await t.freeSlots(WED, BORIS)).not.toContain("10:00");
    const taken = await t.app(BORIS)("POST", "bookings", {
      doctorId: "testova",
      date: WED,
      time: "10:00",
    });
    expect(taken.status).toBe(409);
    let r = await t.say("Хочу записаться к терапевту", BORIS);
    r = await t.press(r, "Анна Тестова", BORIS);
    r = await t.press(r, WED_LABEL, BORIS);
    expect(labels(r)).not.toContain("10:00");
    expect(labels(r)).toContain("10:30");
    const admin = await t.staff("admin");
    expect(
      (await admin("GET", `slots?doctorId=testova&date=${WED}`)).json.data,
    ).not.toContain("10:00");
    const busy = await admin("POST", "bookings", {
      doctorId: "testova",
      date: WED,
      time: "10:00",
    });
    expect(busy.status).toBe(409);

    // 7. Отмена в боте.
    r = await t.say("мои записи");
    const cancelLabel = labels(r).find((l) => l.startsWith("Отменить №"))!;
    r = await t.press(r, cancelLabel);
    r = await t.press(r, "Да, отменить");
    expect(text(r)).toMatch(/отменена/);
    // 8. Время снова свободно везде.
    expect(await t.freeSlots(WED, BORIS)).toContain("10:00");
    expect(
      (await admin("GET", `slots?doctorId=testova&date=${WED}`)).json.data,
    ).toContain("10:00");
    const list = (await admin("GET", `bookings?from=${WED}&to=${WED}`)).json
      .data as { status: string }[];
    expect(list.map((b) => b.status)).toEqual(["cancelled"]);
  });

  it("9. перенос в Mini App виден в боте и панели, старое время освобождается", async () => {
    const t = await setup();
    await t.press(await t.toConfirm(WED_LABEL, "10:00"), "Подтвердить");
    const anna = t.app(ANNA);
    const id = (
      (await anna("GET", "bookings")).json.data as {
        upcoming: { id: number }[];
      }
    ).upcoming[0].id;
    const moved = await anna("PATCH", `bookings/${id}`, {
      action: "reschedule",
      doctorId: "testova",
      date: WED,
      time: "11:30",
    });
    expect(moved.status).toBe(200);
    expect(moved.json.data).toMatchObject({ time: "11:30" });

    expect(text(await t.say("мои записи"))).toMatch(/ср, 21 окт, 11:30/);
    const admin = await t.staff("admin");
    expect(
      (
        (await admin("GET", `bookings?from=${WED}&to=${WED}`)).json.data as {
          id: number;
          time: string;
        }[]
      ).map((b) => [b.id, b.time]),
    ).toEqual([[id, "11:30"]]);
    expect(await t.freeSlots(WED, BORIS)).toContain("10:00");
    expect(await t.freeSlots(WED, BORIS)).not.toContain("11:30");
  });

  it("10. изменение расписания в панели сразу видно боту и Mini App", async () => {
    const t = await setup();
    const admin = await t.staff("admin");
    // Среда 21 октября — выходной врача.
    const off = await admin("POST", "exceptions", {
      doctorId: "testova",
      date: WED,
      from: null,
      to: null,
      reason: "выходной",
    });
    expect(off.status).toBe(200);
    expect(await t.freeSlots(WED)).toEqual([]);
    expect(
      (await t.app(ANNA)("GET", "doctors/testova/days")).json.data,
    ).not.toContain(WED);
    let r = await t.say("Хочу записаться к терапевту");
    r = await t.press(r, "Анна Тестова");
    expect(labels(r)).not.toContain(WED_LABEL);
    const refused = await t.app(ANNA)("POST", "bookings", {
      doctorId: "testova",
      date: WED,
      time: "10:00",
    });
    expect(refused.status).toBe(409);

    // Новые часы приёма: в четверг только с 15:00 до 16:00.
    const hours = await admin("PUT", "schedule/testova/hours", {
      hours: [{ weekday: 4, from: "15:00", to: "16:00" }],
    });
    expect(hours.status).toBe(200);
    expect(await t.freeSlots("2026-10-22")).toEqual(["15:00", "15:30"]);
  });

  it("11. обращение к администратору — только после согласия и только текст пациента", async () => {
    const t = await setup();
    await t.say("у меня болит колено");
    let r = await t.bot.handle(ANNA, { type: "start" });
    r = await t.press(r, "Администратор");
    r = await t.say("Подскажите, можно ли прийти с ребёнком на приём");
    expect(labels(r)).toContain("Разрешаю передачу");
    const admin = await t.staff("admin");
    expect(
      ((await admin("GET", "requests")).json.data as { requests: unknown[] })
        .requests,
    ).toHaveLength(0);
    r = await t.press(r, "Разрешаю передачу");
    expect(text(r)).toMatch(/Передал в панель клиники обращение №1/);
    expect(t.notices).toEqual([{ peerId: ANNA, requestId: 1 }]);
    const content = await admin("GET", "requests/1/content");
    expect(content.json.data).toMatchObject({
      text: "Подскажите, можно ли прийти с ребёнком на приём",
    });
    expect(content.text).not.toMatch(/колен/);
    // Владелец и врач обращения не читают.
    expect((await (await t.staff("owner"))("GET", "requests")).status).toBe(
      403,
    );
    expect(
      (await (await t.staff("dr-testova"))("GET", "requests")).status,
    ).toBe(403);
  });

  it("12. тревожные симптомы: сразу 103/112, без записи, диагнозов и лечения", async () => {
    const t = await setup();
    const emergency = await t.say("Сильная боль в груди и тяжело дышать");
    expect(text(emergency)).toMatch(/позвоните 103.*112/);
    expect(labels(emergency)).not.toContain("Анна Тестова");
    const meds = await t.say("Что выпить от головной боли?", BORIS);
    expect(text(meds)).toMatch(/не советую лекарства или лечение/);
    expect(text(meds)).not.toMatch(/ибупрофен|парацетамол|аспирин|таблетк/i);
    const diagnosis = await t.say(
      "Какой у меня диагноз, если болит горло?",
      2003,
    );
    expect(text(diagnosis)).toMatch(/не ставлю диагнозы/);
    // Ни одна из этих реплик не создала запись.
    const admin = await t.staff("admin");
    expect((await admin("GET", "bookings")).json.data).toEqual([]);
  });
});

describe("живая демонстрация: проблемные ситуации", () => {
  it("одновременная запись из бота, Mini App и панели на одно время — успешна одна", async () => {
    const t = await setup();
    const confirm = await t.toConfirm(WED_LABEL, "10:00");
    const admin = await t.staff("admin");
    const results = await Promise.all([
      t.press(confirm, "Подтвердить"),
      t.app(BORIS)("POST", "bookings", {
        doctorId: "testova",
        date: WED,
        time: "10:00",
      }),
      admin("POST", "bookings", {
        doctorId: "testova",
        date: WED,
        time: "10:00",
      }),
    ]);
    const all = (await admin("GET", `bookings?from=${WED}&to=${WED}`)).json
      .data as { time: string; status: string }[];
    expect(all.filter((b) => b.status === "confirmed")).toHaveLength(1);
    // Проигравшие получили понятный отказ, а не ошибку сервера.
    const [botReply, mini, panel] = results;
    const winners = [
      /подтверждена/.test(text(botReply)),
      mini.status === 200,
      panel.status === 200,
    ].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(
      [mini.status, panel.status].every((s) => s === 200 || s === 409),
    ).toBe(true);
  });

  it("повторное «Подтвердить» и повторная отмена не создают дублей и ошибок", async () => {
    const t = await setup();
    const confirm = await t.toConfirm(WED_LABEL, "10:00");
    await t.press(confirm, "Подтвердить");
    const again = await t.press(confirm, "Подтвердить");
    expect(text(again)).not.toMatch(/ошибк/i);
    const admin = await t.staff("admin");
    expect(
      (await admin("GET", "bookings")).json.data as unknown[],
    ).toHaveLength(1);

    let r = await t.say("мои записи");
    const cancelLabel = labels(r).find((l) => l.startsWith("Отменить №"))!;
    const ask = await t.press(r, cancelLabel);
    r = await t.press(ask, "Да, отменить");
    expect(text(r)).toMatch(/отменена/);
    const twice = await t.press(ask, "Да, отменить");
    expect(text(twice)).not.toMatch(/ошибк/i);
    // Отмена уже отменённой записи из Mini App и панели.
    const id = (
      (await admin("GET", "bookings")).json.data as { id: number }[]
    )[0].id;
    const mini = await t.app(ANNA)("PATCH", `bookings/${id}`, {
      action: "cancel",
    });
    expect(mini.status).toBe(200);
    expect(mini.json.data).toMatchObject({ status: "cancelled" });
    const panel = await admin("PATCH", `bookings/${id}`, { action: "cancel" });
    expect([200, 409]).toContain(panel.status);
  });

  it("будущий приём нельзя отметить состоявшимся — запись остаётся у пациента", async () => {
    const t = await setup();
    await t.press(await t.toConfirm(WED_LABEL, "10:00"), "Подтвердить");
    const admin = await t.staff("admin");
    const id = (
      (await admin("GET", "bookings")).json.data as { id: number }[]
    )[0].id;
    const early = await admin("PATCH", `bookings/${id}`, {
      action: "complete",
    });
    expect(early.status).toBe(409);
    expect(text(await t.say("мои записи"))).toMatch(/ср, 21 окт, 10:00/);
    const mine = (await t.app(ANNA)("GET", "bookings")).json.data as {
      upcoming: { id: number }[];
    };
    expect(mine.upcoming.map((b) => b.id)).toEqual([id]);
  });

  it("запись в недоступное время отклоняется везде", async () => {
    const t = await setup();
    const anna = t.app(ANNA);
    const book = (date: string, time: string) =>
      anna("POST", "bookings", { doctorId: "testova", date, time });
    expect((await book("2026-10-18", "10:00")).status).toBe(409); // прошлое
    expect((await book(WED, "07:00")).status).toBe(409); // до начала приёма
    expect((await book("2026-10-25", "10:00")).status).toBe(409); // воскресенье
    expect((await book(WED, "10:10")).status).toBe(409); // не по сетке
    const admin = await t.staff("admin");
    expect(
      (
        await admin("POST", "bookings", {
          doctorId: "testova",
          date: WED,
          time: "07:00",
        })
      ).status,
    ).toBe(409);
    expect((await admin("GET", "bookings")).json.data).toEqual([]);
  });

  it("некорректные данные: понятный отказ, не ошибка сервера", async () => {
    const t = await setup();
    const anna = t.app(ANNA);
    const statuses = await Promise.all([
      anna("POST", "bookings", { doctorId: "testova", date: "завтра" }),
      anna("POST", "bookings", {
        doctorId: "нет-такого",
        date: WED,
        time: "10:00",
      }),
      anna("GET", "doctors/testova/slots?date=2026-13-45"),
      anna("PATCH", "bookings/abc", { action: "cancel" }),
      anna("PATCH", "bookings/1", { action: "удалить" }),
    ]).then((rs) => rs.map((r) => r.status));
    expect(statuses.every((s) => s >= 400 && s < 500)).toBe(true);
    const admin = await t.staff("admin");
    const bad = await Promise.all([
      admin("POST", "bookings", {
        doctorId: "testova",
        date: WED,
        time: "25:00",
      }),
      admin("PUT", "schedule/testova/hours", { hours: "всегда" }),
      admin("POST", "exceptions", { doctorId: "testova", date: "вчера" }),
    ]).then((rs) => rs.map((r) => r.status));
    expect(bad.every((s) => s >= 400 && s < 500)).toBe(true);
    // Бот на бессмыслицу отвечает и не падает.
    const r = await t.say("%%%$$$###");
    expect(text(r).length).toBeGreaterThan(0);
  });

  it("права: врач не видит чужие записи и разделы администратора, без входа — 401", async () => {
    const t = await setup();
    await t.press(await t.toConfirm(WED_LABEL, "10:00"), "Подтвердить");
    const doctor = await t.staff("dr-testova");
    for (const route of ["bookings", "staff", "requests", "settings"]) {
      expect((await doctor("GET", route)).status, route).toBe(403);
    }
    const anon = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/bookings`, { headers: { host: HOST } }),
      ["bookings"],
      {
        service: new AdminService(t.panelStore, () => NOW),
        auth: new AdminAuth(t.panelStore.admin, () => NOW),
        config: authConfig,
        clientKey: () => "c",
        log: () => {},
      },
    );
    expect(anon.status).toBe(401);
    // Mini App без подписи и с чужой подписью.
    const unsigned = await handleMiniAppApi(
      new Request(`${ORIGIN}/api/miniapp/bookings`),
      ["bookings"],
      {
        service: new MiniAppService(t.panelStore, () => NOW),
        config: miniConfig,
        now: () => NOW,
      },
    );
    expect(unsigned.status).toBe(401);
  });

  it("журналы без текста сообщений, контактов и ключей", async () => {
    const t = await setup();
    await t.say("Мой телефон +7 900 111-22-33, болит колено");
    await t.press(await t.toConfirm(WED_LABEL, "10:00"), "Подтвердить");
    const all = t.logs.join("\n");
    expect(all).not.toMatch(/900|колен|111-22|телефон/);
    expect(all).not.toContain(KEY);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(String(ANNA));
  });
});
