import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAdminApi, type AdminApiDeps } from "@/admin/api";
import { AdminAuth, LoginThrottle, type AuthConfig } from "@/admin/auth";
import {
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/admin/password";
import { AdminService } from "@/admin/service";
import { createDemoBot } from "@/bot";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SCHEMA_VERSION, SqliteStore } from "@/bot/storage/sqlite";

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const HOST = "clinic.example";
const ORIGIN = `https://${HOST}`;
const PASSWORD = "надёжный-пароль-2026";
const config: AuthConfig = { secureCookie: true, allowedOrigins: [] };

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "admin-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "bot.sqlite");
}

async function setup(store = new SqliteStore(":memory:")) {
  let now = NOW;
  const clock = () => now;
  store.admin.createUser(
    "admin",
    await hashPassword(PASSWORD),
    NOW.toISOString(),
    "owner",
  );
  const deps: AdminApiDeps = {
    service: new AdminService(store, clock),
    auth: new AdminAuth(store.admin, clock),
    config,
    clientKey: () => "client-1",
  };
  let cookie = "";
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const url = new URL(`${ORIGIN}/api/admin/${path}`);
    const response = await handleAdminApi(
      new Request(url, {
        method,
        headers: {
          host: HOST,
          ...(method !== "GET" ? { origin: ORIGIN } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
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
      fields?: Record<string, string>;
    };
    return { status: response.status, json, response };
  };
  const login = async () => {
    const r = await call("POST", "login", {
      login: "admin",
      password: PASSWORD,
    });
    cookie = r.response.headers.get("set-cookie")!.split(";")[0];
    return r;
  };
  return {
    store,
    deps,
    call,
    login,
    setCookie: (value: string) => (cookie = value),
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

describe("пароли", () => {
  it("хранится только хэш scrypt с солью; проверка за постоянное время", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain(PASSWORD);
    expect(await hashPassword(PASSWORD)).not.toBe(hash);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("другой-пароль-1", hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, "мусор")).toBe(false);
  });

  it("требования к паролю", () => {
    expect(passwordProblem("короткий1")).toMatch(/не короче/);
    expect(passwordProblem("толькобуквыбезцифр")).toMatch(/буквы и цифры/);
    expect(passwordProblem(PASSWORD)).toBeUndefined();
  });
});

describe("авторизация и защита API", () => {
  it("вход: cookie __Host-, HttpOnly, SameSite=Strict, Secure; в базе только хэш токена", async () => {
    const t = await setup();
    const r = await t.login();
    expect(r.status).toBe(200);
    const header = r.response.headers.get("set-cookie")!;
    expect(header).toMatch(/^__Host-admin_session=[A-Za-z0-9_-]{43};/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Secure");
    const token = header.split(";")[0].split("=")[1];
    const db = JSON.stringify(t.store.admin.listUsers());
    expect(db).not.toContain(PASSWORD);
    expect((await t.call("GET", "me")).json.data).toEqual({
      login: "admin",
      role: "owner",
      doctorId: null,
    });
    // Токен в базе не хранится.
    expect(t.deps.auth.verify(token)).toBeDefined();
    expect(t.deps.auth.verify(`${token}x`)).toBeUndefined();
  });

  it("неверный пароль — 401, после 5 ошибок — 429 даже с верным паролем", async () => {
    const t = await setup();
    for (let i = 0; i < 5; i++) {
      const r = await t.call("POST", "login", {
        login: "admin",
        password: "неверный-1",
      });
      expect(r.status).toBe(401);
      expect(r.json.error).toBe("Неверный логин или пароль.");
    }
    const locked = await t.call("POST", "login", {
      login: "admin",
      password: PASSWORD,
    });
    expect(locked.status).toBe(429);
    t.advance(16 * 60_000);
    expect((await t.login()).status).toBe(200);
  });

  it("неизвестный логин и отключённый администратор — тот же ответ", async () => {
    const t = await setup();
    expect(
      (await t.call("POST", "login", { login: "nobody", password: PASSWORD }))
        .status,
    ).toBe(401);
    t.store.admin.setDisabled("admin", true, NOW.toISOString());
    expect(
      (await t.call("POST", "login", { login: "admin", password: PASSWORD }))
        .status,
    ).toBe(401);
  });

  it.each([
    ["GET", "me"],
    ["GET", "dashboard"],
    ["GET", "bookings"],
    ["POST", "bookings"],
    ["PATCH", "bookings/1"],
    ["GET", "doctors"],
    ["POST", "doctors"],
    ["PATCH", "doctors/testova"],
    ["DELETE", "doctors/testova"],
    ["GET", "schedule/testova"],
    ["PUT", "schedule/testova/hours"],
    ["POST", "exceptions"],
    ["GET", "settings"],
    ["PUT", "settings"],
    ["GET", "slots"],
  ])("%s /%s без входа — 401", async (method, path) => {
    const t = await setup();
    const r = await t.call(method, path, method === "GET" ? undefined : {});
    expect(r.status).toBe(401);
  });

  it("изменяющие запросы — только со своего сайта и только JSON", async () => {
    const t = await setup();
    await t.login();
    const body = { title: "Невролог", toWhom: "к неврологу" };
    expect(
      (
        await t.call("POST", "specialties", body, {
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    const noOrigin = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/specialties`, {
        method: "POST",
        headers: { host: HOST, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      ["specialties"],
      t.deps,
    );
    expect(noOrigin.status).toBe(403);
    expect(
      (
        await t.call("POST", "specialties", undefined, {
          "content-type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect((await t.call("POST", "specialties", body)).status).toBe(200);
  });

  it("выход и истёкшая сессия закрывают доступ", async () => {
    const t = await setup();
    await t.login();
    expect((await t.call("POST", "logout", {})).status).toBe(200);
    expect((await t.call("GET", "me")).status).toBe(401);
    await t.login();
    t.advance(9 * 60 * 60_000);
    expect((await t.call("GET", "me")).status).toBe(401);
  });

  it("ограничитель попыток считает по адресу и по логину", () => {
    let now = 0;
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < 5; i++) throttle.fail(["ip:a", "login:x"]);
    expect(throttle.isLocked(["ip:b", "login:x"])).toBe(true);
    expect(throttle.isLocked(["ip:a", "login:y"])).toBe(true);
    expect(throttle.isLocked(["ip:b", "login:y"])).toBe(false);
    now = 15 * 60_000 + 1;
    expect(throttle.isLocked(["ip:a", "login:x"])).toBe(false);
  });
});

describe("врачи", () => {
  it("создание, проверка данных, цена, отключение, удаление с защитой записей", async () => {
    const t = await setup();
    await t.login();
    const bad = await t.call("POST", "doctors", {
      name: "А",
      specialtyId: "therapist",
      about: "",
      slotMinutes: 7,
      priceRub: -1,
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.fields!)).toEqual(
      expect.arrayContaining(["name", "slotMinutes", "priceRub"]),
    );
    const unknown = await t.call("POST", "doctors", {
      name: "Пётр Новиков",
      specialtyId: "astrology",
      about: "",
      slotMinutes: 30,
      priceRub: null,
    });
    expect(unknown.status).toBe(400);

    const created = await t.call("POST", "doctors", {
      name: "Пётр Новиков",
      specialtyId: "therapist",
      about: "Терапевт (вымышленный).",
      slotMinutes: 30,
      priceRub: 2500,
    });
    expect(created.status).toBe(200);
    const id = (created.json.data as { id: string }).id;
    await t.call("PUT", `schedule/${id}/hours`, {
      hours: [{ weekday: 2, from: "09:00", to: "11:00" }],
    });

    const edited = await t.call("PATCH", `doctors/${id}`, {
      name: "Пётр Новиков",
      specialtyId: "therapist",
      about: "Терапевт.",
      slotMinutes: 30,
      priceRub: 2700,
    });
    expect(edited.json.data).toMatchObject({ priceRub: 2700 });

    const booking = await t.call("POST", "bookings", {
      doctorId: id,
      date: "2026-10-20",
      time: "09:00",
    });
    expect(booking.status).toBe(200);
    const blocked = await t.call("DELETE", `doctors/${id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toMatch(/предстоящие записи/);

    expect(
      (await t.call("PATCH", `doctors/${id}`, { active: false })).json.data,
    ).toMatchObject({ active: false });
    const bookingId = (booking.json.data as { id: number }).id;
    await t.call("PATCH", `bookings/${bookingId}`, { action: "cancel" });
    expect((await t.call("DELETE", `doctors/${id}`)).status).toBe(200);
    // Врач скрыт, а история записи сохраняет его имя.
    const list = (await t.call("GET", "doctors")).json.data as {
      doctors: { id: string }[];
    };
    expect(list.doctors.map((d) => d.id)).not.toContain(id);
    const history = (await t.call("GET", "bookings?status=cancelled")).json
      .data as { doctorName: string }[];
    expect(history[0].doctorName).toBe("Пётр Новиков");
  });

  it("специальности: создание и переименование", async () => {
    const t = await setup();
    await t.login();
    const r = await t.call("POST", "specialties", {
      title: "Невролог",
      toWhom: "к неврологу",
    });
    const id = (r.json.data as { id: string }).id;
    expect(
      (
        await t.call("PATCH", `specialties/${id}`, {
          title: "Невролог (взрослый)",
          toWhom: "к неврологу",
        })
      ).status,
    ).toBe(200);
    expect(
      t.store.clinic.listSpecialties().find((s) => s.id === id)?.title,
    ).toBe("Невролог (взрослый)");
  });
});

describe("расписание", () => {
  // Хранилище отбрасывает исключения расписания старше двух дней по системным
  // часам (clinic-store.ts), а даты в тестах фиксированы: без подмены часов
  // тесты начинают падать, когда эти даты проходят.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("часы приёма, пересечения, выходной, перерыв, праздник клиники", async () => {
    const t = await setup();
    await t.login();
    const overlap = await t.call("PUT", "schedule/testova/hours", {
      hours: [
        { weekday: 2, from: "09:00", to: "12:00" },
        { weekday: 2, from: "11:00", to: "13:00" },
      ],
    });
    expect(overlap.status).toBe(400);
    expect(overlap.json.error).toMatch(/не должны пересекаться/);
    expect(
      (
        await t.call("PUT", "schedule/testova/hours", {
          hours: [{ weekday: 2, from: "10:00", to: "09:00" }],
        })
      ).status,
    ).toBe(400);

    await t.call("PUT", "schedule/testova/hours", {
      hours: [
        { weekday: 2, from: "09:00", to: "11:00" },
        { weekday: 2, from: "14:00", to: "15:00" },
      ],
    });
    const slots = async (date: string) =>
      (await t.call("GET", `slots?doctorId=testova&date=${date}`)).json
        .data as string[];
    expect(await slots("2026-10-20")).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
      "14:00",
      "14:30",
    ]);
    // Понедельник больше не рабочий.
    expect(await slots("2026-10-19")).toEqual([]);

    const pause = await t.call("POST", "exceptions", {
      doctorId: "testova",
      date: "2026-10-20",
      from: "09:30",
      to: "10:30",
      reason: "совещание",
    });
    expect(pause.status).toBe(200);
    expect(await slots("2026-10-20")).toEqual([
      "09:00",
      "10:30",
      "14:00",
      "14:30",
    ]);

    await t.call("POST", "exceptions", {
      doctorId: null,
      date: "2026-10-27",
      from: null,
      to: null,
      reason: "праздник",
    });
    expect(await slots("2026-10-27")).toEqual([]);
    expect(
      (await t.call("GET", "slots?doctorId=primerov&date=2026-10-27")).json
        .data,
    ).toEqual([]);

    const exceptions = (await t.call("GET", "exceptions")).json.data as {
      id: number;
    }[];
    expect(exceptions).toHaveLength(2);
    await t.call("DELETE", `exceptions/${exceptions[0].id}`);
    expect(await slots("2026-10-20")).toContain("09:30");

    expect(
      (
        await t.call("POST", "exceptions", {
          doctorId: null,
          date: "2026-10-01",
          from: null,
          to: null,
          reason: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call("POST", "exceptions", {
          doctorId: null,
          date: "2026-10-28",
          from: "10:00",
          to: null,
          reason: "",
        })
      ).status,
    ).toBe(400);
  });

  it("выходной сообщает, сколько записей уже стоит на этот день", async () => {
    const t = await setup();
    await t.login();
    await t.call("POST", "bookings", {
      doctorId: "testova",
      date: "2026-10-21",
      time: "09:00",
    });
    const r = await t.call("POST", "exceptions", {
      doctorId: "testova",
      date: "2026-10-21",
      from: null,
      to: null,
      reason: "отпуск",
    });
    expect(r.json.data).toMatchObject({ affectedBookings: 1 });
  });
});

describe("записи", () => {
  it("создание, перенос, завершение, отмена; статусы и фильтры", async () => {
    const t = await setup();
    await t.login();
    const created = await t.call("POST", "bookings", {
      doctorId: "testova",
      date: "2026-10-19",
      time: "09:30",
      note: "демо-пациент",
    });
    // Администратор может записать ближе часа до приёма.
    expect(created.status).toBe(200);
    const id = (created.json.data as { id: number }).id;
    expect(created.json.data).toMatchObject({
      source: "admin",
      status: "confirmed",
      patient: "Запись администратора",
    });

    const busy = await t.call("POST", "bookings", {
      doctorId: "testova",
      date: "2026-10-19",
      time: "09:30",
    });
    expect(busy.status).toBe(409);
    expect(busy.json.error).toMatch(/уже занято/);
    expect(
      (
        await t.call("POST", "bookings", {
          doctorId: "testova",
          date: "2026-10-19",
          time: "08:00",
        })
      ).json.error,
    ).toMatch(/нет в расписании/);

    const moved = await t.call("PATCH", `bookings/${id}`, {
      action: "reschedule",
      doctorId: "primerov",
      date: "2026-10-20",
      time: "10:00",
    });
    expect(moved.json.data).toMatchObject({
      doctorId: "primerov",
      date: "2026-10-20",
      time: "10:00",
    });
    expect(
      (await t.call("PATCH", `bookings/${id}`, { action: "complete" })).json
        .data,
    ).toMatchObject({ status: "completed" });
    expect(
      (await t.call("PATCH", `bookings/${id}`, { action: "cancel" })).status,
    ).toBe(409);

    const second = await t.call("POST", "bookings", {
      doctorId: "testova",
      date: "2026-10-21",
      time: "09:00",
    });
    const secondId = (second.json.data as { id: number }).id;
    expect(
      (await t.call("PATCH", `bookings/${secondId}`, { action: "cancel" })).json
        .data,
    ).toMatchObject({ status: "cancelled" });
    // Отменённое время снова свободно.
    expect(
      (await t.call("GET", "slots?doctorId=testova&date=2026-10-21")).json.data,
    ).toContain("09:00");

    const list = async (q: string) =>
      (
        (await t.call("GET", `bookings?${q}`)).json.data as { id: number }[]
      ).map((b) => b.id);
    expect(await list("status=completed")).toEqual([id]);
    expect(await list("status=cancelled")).toEqual([secondId]);
    expect(await list("doctorId=primerov")).toEqual([id]);
    expect(await list(`query=${id}`)).toEqual([id]);
    expect(await list("query=демо")).toEqual([id]);
    expect((await t.call("GET", "bookings?from=2026-13-01")).status).toBe(400);
  });

  it("главная: записи на сегодня, неделя, обращения, статус бота", async () => {
    const t = await setup();
    await t.login();
    await t.call("POST", "bookings", {
      doctorId: "testova",
      date: "2026-10-19",
      time: "10:00",
    });
    t.store.incrementStat("2026-10-19", "messages_received", 5);
    t.store.setBotStatus(
      "last_poll_at",
      new Date(NOW.getTime() - 30_000).toISOString(),
      NOW.toISOString(),
    );
    const data = (await t.call("GET", "dashboard")).json.data as {
      todayBookings: unknown[];
      week: { confirmed: number; fromAdmin: number };
      requests: { messages: number };
      bot: { online: boolean };
    };
    expect(data.todayBookings).toHaveLength(1);
    expect(data.week).toMatchObject({ confirmed: 1, fromAdmin: 1 });
    expect(data.requests.messages).toBe(5);
    expect(data.bot.online).toBe(true);
    t.advance(5 * 60_000);
    expect(
      (
        (await t.call("GET", "dashboard")).json.data as {
          bot: { online: boolean };
        }
      ).bot.online,
    ).toBe(false);
  });
});

describe("конкурентное бронирование", () => {
  it("бот и панель — разные процессы с одной базой: один слот достаётся одному", async () => {
    const path = tempDb();
    const botStore = new SqliteStore(path);
    const panelStore = new SqliteStore(path);
    cleanups.push(() => {
      botStore.close();
      panelStore.close();
    });
    const bot = new ClinicSchedule(
      () => botStore.clinic.load(),
      botStore,
      () => NOW,
    );
    const panel = new AdminService(panelStore, () => NOW);
    expect(bot.book(42, "testova", "2026-10-21", "09:00").status).toBe("ok");
    expect(() =>
      panel.createBooking(
        { doctorId: "testova", date: "2026-10-21", time: "09:00" },
        1,
      ),
    ).toThrow(/уже занято/);
    panel.createBooking(
      { doctorId: "testova", date: "2026-10-21", time: "09:30" },
      1,
    );
    expect(bot.book(43, "testova", "2026-10-21", "09:30").status).toBe("taken");
    // Бот больше не предлагает занятое время.
    expect(bot.listFreeSlots("testova", "2026-10-21")).not.toContain("09:30");
  });

  it("одновременные попытки записать на один слот: ровно одна удачна", async () => {
    const path = tempDb();
    const stores = Array.from({ length: 4 }, () => new SqliteStore(path));
    cleanups.push(() => stores.forEach((s) => s.close()));
    const results = await Promise.all(
      stores.map(
        async (store, i) =>
          new ClinicSchedule(
            () => store.clinic.load(),
            store,
            () => NOW,
          ).book(100 + i, "primerov", "2026-10-20", "10:00").status,
      ),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "taken")).toHaveLength(3);
  });
});

describe("синхронизация панели и бота", () => {
  it("изменения в панели бот видит со следующего сообщения; запись из ВК видна в панели", async () => {
    const path = tempDb();
    const { bot, store: botStore } = createDemoBot({
      dbPath: path,
      now: () => NOW,
    });
    const panelStore = new SqliteStore(path);
    cleanups.push(() => {
      botStore.close();
      panelStore.close();
    });
    const panel = new AdminService(panelStore, () => NOW);
    const say = async (text: string) =>
      (await bot.handle(7, { type: "text", text }))
        .map((r) => r.text)
        .join("\n");

    // Цена врача и новые часы приёма.
    const maketov = panel
      .listDoctors()
      .doctors.find((d) => d.id === "maketov")!;
    panel.updateDoctor(
      "maketov",
      {
        name: maketov.name,
        specialtyId: "orthopedist",
        about: maketov.about,
        slotMinutes: 30,
        priceRub: 3100,
      },
      1,
    );
    expect(await say("Сколько стоит приём?")).toMatch(
      /Игорь Макетов — 3 100 ₽/,
    );

    // Отключённый врач исчезает из выбора.
    panel.updateDoctor("primerov", { active: false }, 1);
    expect(await say("хочу к терапевту")).not.toMatch(/Павел Примеров/);

    // Выходной врача: бот не предлагает этот день.
    panel.addException(
      {
        doctorId: "testova",
        date: "2026-10-21",
        from: null,
        to: null,
        reason: "",
      },
      1,
    );
    const days = await say("хочу к терапевту");
    expect(days).toMatch(/Анна Тестова/);
    const schedule = new ClinicSchedule(
      () => botStore.clinic.load(),
      botStore,
      () => NOW,
    );
    expect(schedule.listAvailableDays("testova")).not.toContain("2026-10-21");

    // Слот, занятый администратором, бот больше не предлагает.
    panel.createBooking(
      { doctorId: "testova", date: "2026-10-19", time: "10:00" },
      1,
    );
    expect(schedule.listFreeSlots("testova", "2026-10-19")).not.toContain(
      "10:00",
    );

    // Запись пациента через бота появляется в панели.
    expect(schedule.book(7, "testova", "2026-10-23", "14:00").status).toBe(
      "ok",
    );
    const fromVk = panel.listBookings({ source: "vk" });
    expect(fromVk).toMatchObject([
      {
        doctorName: "Анна Тестова",
        date: "2026-10-23",
        patient: "ВКонтакте, id…7",
      },
    ]);

    // Название клиники в ответах бота.
    const settings = panel.getSettings();
    panel.updateSettings(
      {
        settings: { ...settings.settings, name: "Клиника «Новая» (демо)" },
        services: settings.services,
      },
      1,
    );
    expect(await say("здравствуйте")).toMatch(/Клиника «Новая» \(демо\)/);
  });
});

describe("миграции", () => {
  it("старая база (версия 3): записи сохраняются, статусы проставляются, справочники заполняются", () => {
    const path = tempDb();
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, peer_id INTEGER NOT NULL, doctor_id TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, created_at TEXT NOT NULL, cancelled_at TEXT);
      CREATE UNIQUE INDEX bookings_active_slot ON bookings (doctor_id, date, time) WHERE cancelled_at IS NULL;
      CREATE INDEX bookings_peer ON bookings (peer_id, cancelled_at);
      CREATE TABLE sessions (peer_id INTEGER PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE pauses (peer_id INTEGER PRIMARY KEY, until TEXT NOT NULL);
      CREATE TABLE processed_events (event_key TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
      CREATE TABLE notices (peer_id INTEGER NOT NULL, kind TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (peer_id, kind));
      CREATE INDEX sessions_updated ON sessions (updated_at);
      CREATE TABLE stats (day TEXT NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key));
      INSERT INTO bookings (peer_id, doctor_id, date, time, created_at) VALUES (11, 'maketov', '2026-10-20', '09:00', '2026-10-18T10:00:00Z');
      INSERT INTO bookings (peer_id, doctor_id, date, time, created_at, cancelled_at) VALUES (12, 'testova', '2026-10-19', '10:00', '2026-10-18T10:00:00Z', '2026-10-18T11:00:00Z');
      INSERT INTO sessions VALUES (11, '{"step":"menu"}', '2026-10-18T10:00:00Z');
      PRAGMA user_version = 3;
    `);
    old.close();

    const store = new SqliteStore(path);
    cleanups.push(() => store.close());
    expect(store.schemaVersion).toBe(SCHEMA_VERSION);
    const all = store.searchBookings({});
    expect(all).toMatchObject([
      { peerId: 12, doctorId: "testova", status: "cancelled", source: "vk" },
      { peerId: 11, doctorId: "maketov", status: "confirmed", source: "vk" },
    ]);
    // Справочники заполнены прежней вымышленной клиникой: id врачей совпадают.
    expect(store.clinic.load().doctors.map((d) => d.id)).toContain("maketov");
    const schedule = new ClinicSchedule(
      () => store.clinic.load(),
      store,
      () => NOW,
    );
    expect(schedule.listFreeSlots("maketov", "2026-10-20")).not.toContain(
      "09:00",
    );
    expect(store.load(11)?.state).toEqual({ step: "menu" });
    store.close();
    cleanups.pop();

    // Повторное открытие ничего не меняет и не дублирует данные.
    const again = new SqliteStore(path);
    cleanups.push(() => again.close());
    expect(again.searchBookings({})).toHaveLength(2);
    expect(again.clinic.listSpecialties()).toHaveLength(5);
  });

  it("два процесса открывают новую базу одновременно — миграции применяются один раз", () => {
    const path = tempDb();
    const a = new SqliteStore(path);
    const b = new SqliteStore(path);
    cleanups.push(() => {
      a.close();
      b.close();
    });
    expect(a.schemaVersion).toBe(SCHEMA_VERSION);
    expect(b.clinic.listSpecialties()).toHaveLength(5);
  });
});
