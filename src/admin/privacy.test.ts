import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { handleAdminApi, type AdminApiDeps } from "@/admin/api";
import { AdminAuth, type AuthConfig } from "@/admin/auth";
import { hashPassword, verifyPassword } from "@/admin/password";
import { can, PERMISSIONS } from "@/admin/permissions";
import { noteProblem } from "@/admin/schemas";
import { AdminService } from "@/admin/service";
import { createDemoBot } from "@/bot";
import { parseSession } from "@/bot/conversation/memory";
import { HANDOFF_QUESTION, PRIVACY_NOTICE } from "@/bot/dialog/dialog";
import type { Reply } from "@/bot/dialog/types";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import type { StaffRole } from "@/bot/storage/admin-store";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import { SCHEMA_VERSION, SqliteStore } from "@/bot/storage/sqlite";
import { VkAdminNotifier } from "@/bot/vk/runner";

/*
 * Медицинская конфиденциальность и разграничение доступа (этап 2).
 * Только вымышленные данные: клиника «Демо-Мед», VK ID — условные числа.
 */

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const HOST = "clinic.example";
const ORIGIN = `https://${HOST}`;
const PASSWORD = "надёжный-пароль-2026";
const PEER = 7;
const KEY = MedicalCipher.generateKey();
const config: AuthConfig = { secureCookie: true, allowedOrigins: [] };
/** Фраза пациента из сценария — по ней ищем утечки. */
const COMPLAINT = "у меня болит колено";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "privacy-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "bot.sqlite");
}

type Json = {
  ok: boolean;
  data?: unknown;
  error?: string;
  fields?: Record<string, string>;
};

/** Бот и панель над одной базой (как на сервере) и сотрудники всех ролей. */
async function setup({ cipher = true }: { cipher?: boolean } = {}) {
  const path = tempDb();
  const now = () => NOW;
  const notices: number[] = [];
  const logs: string[] = [];
  const { bot, store } = createDemoBot({
    dbPath: path,
    now,
    cipher: cipher ? MedicalCipher.fromBase64(KEY) : undefined,
    notifier: { notifyHandoff: async (peerId) => void notices.push(peerId) },
    log: (m) => logs.push(m),
  });
  // Панель — отдельный процесс со своим подключением к той же базе.
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
    ["dr-testova", "doctor", "testova"],
  ];
  for (const [login, role, doctorId] of users)
    panelStore.admin.createUser(login, hash, NOW.toISOString(), role, doctorId);

  const service = new AdminService(panelStore, now);
  const deps: AdminApiDeps = {
    service,
    auth: new AdminAuth(panelStore.admin, now),
    config,
    clientKey: () => "client-1",
    log: (m) => logs.push(m),
  };
  const request = async (
    cookie: string,
    method: string,
    path: string,
    body?: unknown,
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
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      url.pathname.replace("/api/admin/", "").split("/").filter(Boolean),
      deps,
    );
    const json = (await response.json()) as Json;
    return { status: response.status, json, text: JSON.stringify(json) };
  };
  /** Вход сотрудника; дальше запросы идут с его cookie. */
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
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    return (method: string, path: string, body?: unknown) =>
      request(cookie, method, path, body);
  };

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
  /** Сценарий по правилам (без OpenAI): колено → ортопед → запись. */
  const bookKnee = async () => {
    let r = await say(COMPLAINT);
    r = await say("Без травмы");
    r = await say("Уже дня четыре");
    r = await say("Нет, просто иногда ноет");
    r = await press(r, "Ближайшее время");
    r = await say("да");
    expect(text(r)).toMatch(/подтверждена/);
    const booking = panelStore
      .searchBookings({})
      .find((b) => b.peerId === PEER)!;
    expect(booking.doctorId).toBe("maketov");
    return { replies: r, booking };
  };
  /** Пациент сам передаёт описание жалобы врачу записи. */
  const share = async (afterBooking: Reply[]) => {
    const preview = await press(afterBooking, "Передать врачу описание");
    const done = await press(preview, "Передать врачу");
    return { preview, done };
  };

  return {
    path,
    bot,
    store,
    panelStore,
    service,
    deps,
    notices,
    logs,
    as,
    request,
    say,
    press,
    bookKnee,
    share,
  };
}

const text = (replies: Reply[]) => replies.map((r) => r.text).join("\n");
const labels = (replies: Reply[]) =>
  replies.flatMap((r) => r.buttons.flat()).map((b) => b.label);

describe("права ролей", () => {
  it("у owner и admin нет ни одного медицинского права", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(can(role, "own_medical.request")).toBe(false);
      expect(can(role, "own_bookings.read")).toBe(false);
    }
    // Медицинское право есть только у врача — и то лишь «запросить по своей записи».
    const medical = Object.entries(PERMISSIONS).filter(([key]) =>
      key.includes("medical"),
    );
    for (const [key, roles] of medical) {
      if (key === "medical_log.read") expect(roles).toEqual(["owner"]);
      else expect(roles).toEqual(["doctor"]);
    }
  });
});

describe("1. администратор не читает медицинские данные", () => {
  it("ни в записях, ни на главной, ни в разделе врача", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    await t.share(replies);
    const admin = await t.as("admin");

    for (const path of [
      "bookings",
      `bookings?query=${encodeURIComponent("колено")}`,
      "dashboard",
      "doctors",
    ]) {
      const r = await admin("GET", path);
      expect(r.status).toBe(200);
      // Описание врачей («суставы») — данные клиники; ищем слова пациента.
      expect(r.text).not.toMatch(/болит колено|ноет|дня четыре/);
    }
    expect((await admin("GET", "my/bookings")).status).toBe(403);
    expect((await admin("GET", `my/${booking.id}/medical`)).status).toBe(403);
    expect((await admin("GET", "medical-log")).status).toBe(403);
    expect((await admin("GET", "staff")).status).toBe(403);
    // Настройки клиники — только владелец.
    expect((await admin("GET", "settings")).status).toBe(403);
  });

  it("пометка записи не принимает жалобы, симптомы и контакты", async () => {
    const t = await setup();
    const admin = await t.as("admin");
    for (const note of [
      "болит колено после падения",
      "температура 39, кашель",
      "звонить +7 900 000-00-00",
      "пациент@example.com",
    ]) {
      const r = await admin("POST", "bookings", {
        doctorId: "testova",
        date: "2026-10-21",
        time: "09:00",
        note,
      });
      expect(r.status, note).toBe(400);
      expect(r.json.error).toMatch(/Пометка/);
    }
    expect(noteProblem("перезвонить вечером")).toBeUndefined();
    expect(noteProblem("первичный приём")).toBeUndefined();
    const ok = await admin("POST", "bookings", {
      doctorId: "testova",
      date: "2026-10-21",
      time: "09:00",
      note: "перезвонить вечером",
    });
    expect(ok.status).toBe(200);
  });
});

describe("2. владелец не получает медицинский доступ автоматически", () => {
  it("роль owner не открывает сведения и не видит их в журнале", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    await t.share(replies);
    const owner = await t.as("owner");
    expect((await owner("GET", `my/${booking.id}/medical`)).status).toBe(403);
    expect((await owner("GET", "my/bookings")).status).toBe(403);
    // Журнал доступа — только метаданные.
    const log = await owner("GET", "medical-log");
    expect(log.status).toBe(200);
    expect(log.text).not.toMatch(/колен|ноет|четыре/);
    for (const path of ["bookings", "dashboard", "staff", "settings"]) {
      const r = await owner("GET", path);
      expect(r.status).toBe(200);
      expect(r.text).not.toMatch(/колен|ноет|четыре/);
    }
  });

  it("владелец не может выдать себе роль врача и не может понизить себя", async () => {
    const t = await setup();
    const owner = await t.as("owner");
    const me = t.panelStore.admin.findUser("owner")!;
    const r = await owner("PATCH", `staff/${me.id}`, {
      role: "doctor",
      doctorId: "obraztsova",
    });
    expect(r.status).toBe(409);
    expect(t.panelStore.admin.findUser("owner")!.role).toBe("owner");
  });
});

describe("3. врач не видит пациентов другого врача", () => {
  it("свои приёмы — только к своему врачу; чужая запись — отказ и запись в журнал", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    await t.share(replies);
    // Запись к другому врачу.
    t.panelStore.insert({
      peerId: 99,
      doctorId: "testova",
      date: "2026-10-20",
      time: "10:00",
      createdAt: NOW.toISOString(),
    });

    const testova = await t.as("dr-testova");
    const mine = await testova(
      "GET",
      "my/bookings?from=2026-10-19&to=2026-11-19",
    );
    expect(mine.status).toBe(200);
    const list = (mine.json.data as { bookings: { doctorId: string }[] })
      .bookings;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((b) => b.doctorId === "testova")).toBe(true);

    const other = await testova("GET", `my/${booking.id}/medical`);
    expect(other.status).toBe(404);
    expect(other.text).not.toMatch(/колен|ноет/);

    // Записи всей клиники, главная и управление — не для врача.
    for (const path of ["bookings", "dashboard", "doctors", "staff"])
      expect((await testova("GET", path)).status).toBe(403);
    expect(
      (
        await testova("POST", "bookings", {
          doctorId: "testova",
          date: "2026-10-22",
          time: "09:00",
        })
      ).status,
    ).toBe(403);

    const log = t.panelStore.consents.listAccessLog();
    expect(log[0]).toMatchObject({
      login: "dr-testova",
      bookingId: booking.id,
      result: "denied_not_own_booking",
    });
  });

  it("врач записи видит сведения только по согласию; открытие — в журнале", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    const maketov = await t.as("dr-maketov");

    // До согласия: запись видна, сведений нет.
    let mine = await maketov("GET", "my/bookings");
    expect(mine.text).toMatch(/"medicalShared":false/);
    expect((await maketov("GET", `my/${booking.id}/medical`)).status).toBe(404);

    await t.share(replies);
    mine = await maketov("GET", "my/bookings");
    expect(mine.text).toMatch(/"medicalShared":true/);
    // Список не раскрывает содержание — только по отдельному запросу.
    expect(mine.text).not.toMatch(/колен|ноет/);
    const r = await maketov("GET", `my/${booking.id}/medical`);
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({
      bookingId: booking.id,
      area: "суставы, спина, травмы",
      summary: COMPLAINT,
      trauma: "no",
      duration: "дня четыре",
      redFlagsDenied: true,
    });
    expect(r.text).toMatch(/Личность не подтверждена/);
    expect(t.panelStore.consents.listAccessLog()[0]).toMatchObject({
      login: "dr-maketov",
      bookingId: booking.id,
      result: "granted",
    });
  });
});

describe("4. прямые запросы к API не обходят ограничения", () => {
  it("без сессии, с чужой ролью, с перебором номеров и путей", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    await t.share(replies);
    // Без входа.
    expect(
      (await t.request("", "GET", `my/${booking.id}/medical`)).status,
    ).toBe(401);
    const testova = await t.as("dr-testova");
    // Перебор номеров: ответ одинаковый для чужой и несуществующей записи.
    const a = await testova("GET", `my/${booking.id}/medical`);
    const b = await testova("GET", "my/99999/medical");
    expect([a.status, a.json.error]).toEqual([b.status, b.json.error]);
    // Нестандартные пути не ведут к данным.
    for (const path of [
      `my/${booking.id}/medical/extra`,
      `my/${booking.id}`,
      "my",
      `bookings/${booking.id}/medical`,
      "my/-1/medical",
      "my/abc/medical",
    ])
      expect([403, 404], path).toContain((await testova("GET", path)).status);
  });

  it("отмена, перенос к другому врачу и отзыв закрывают доступ", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    await t.share(replies);
    const maketov = await t.as("dr-maketov");
    const admin = await t.as("admin");
    expect((await maketov("GET", `my/${booking.id}/medical`)).status).toBe(200);

    // Перенос к другому врачу: согласие давалось врачу этой записи.
    const moved = await admin("PATCH", `bookings/${booking.id}`, {
      action: "reschedule",
      doctorId: "testova",
      date: "2026-10-21",
      time: "11:00",
    });
    expect(moved.status).toBe(200);
    expect((await maketov("GET", `my/${booking.id}/medical`)).status).toBe(404);
    const testova = await t.as("dr-testova");
    expect((await testova("GET", `my/${booking.id}/medical`)).status).toBe(404);
    expect(t.panelStore.consents.countActive("doctor", NOW.toISOString())).toBe(
      0,
    );
  });

  it("смена роли и отключение завершают сессии сотрудника", async () => {
    const t = await setup();
    const maketov = await t.as("dr-maketov");
    expect((await maketov("GET", "my/bookings")).status).toBe(200);
    const owner = await t.as("owner");
    const user = t.panelStore.admin.findUser("dr-maketov")!;
    expect(
      (await owner("PATCH", `staff/${user.id}`, { role: "admin" })).status,
    ).toBe(200);
    expect((await maketov("GET", "my/bookings")).status).toBe(401);

    const admin = await t.as("admin");
    const adminUser = t.panelStore.admin.findUser("admin")!;
    await owner("PATCH", `staff/${adminUser.id}`, { disabled: true });
    expect((await admin("GET", "bookings")).status).toBe(401);
  });

  it("сотрудников и приглашения меняет только владелец", async () => {
    const t = await setup();
    const admin = await t.as("admin");
    const doctor = await t.as("dr-testova");
    const target = t.panelStore.admin.findUser("dr-maketov")!;
    for (const call of [admin, doctor]) {
      expect((await call("GET", "staff")).status).toBe(403);
      expect(
        (await call("POST", "invites", { login: "new.one", role: "owner" }))
          .status,
      ).toBe(403);
      expect(
        (await call("PATCH", `staff/${target.id}`, { role: "owner" })).status,
      ).toBe(403);
    }
    expect(t.panelStore.admin.findUser("dr-maketov")!.role).toBe("doctor");
  });
});

describe("приглашения сотрудников", () => {
  it("одноразовая ссылка: сотрудник сам задаёт пароль, повтор не работает", async () => {
    const t = await setup();
    const owner = await t.as("owner");
    // Врач уже связан с учётной записью — второй нельзя.
    const taken = await owner("POST", "invites", {
      login: "second.maketov",
      role: "doctor",
      doctorId: "maketov",
    });
    expect(taken.status).toBe(409);
    const noDoctor = await owner("POST", "invites", {
      login: "dr.x",
      role: "doctor",
    });
    expect(noDoctor.status).toBe(400);

    const r = await owner("POST", "invites", {
      login: "dr.obraztsova",
      role: "doctor",
      doctorId: "obraztsova",
    });
    expect(r.status).toBe(200);
    const { token } = r.json.data as { token: string };
    // В базе — только хэш токена.
    const raw = new DatabaseSync(t.path);
    cleanups.push(() => raw.close());
    expect(
      JSON.stringify(raw.prepare("SELECT * FROM staff_invites").all()),
    ).not.toContain(token);

    const info = await t.request("", "POST", "invite/info", { token });
    expect(info.json.data).toEqual({ login: "dr.obraztsova", role: "doctor" });
    const weak = await t.request("", "POST", "invite/accept", {
      token,
      password: "короткий",
    });
    expect(weak.status).toBe(400);
    const ok = await t.request("", "POST", "invite/accept", {
      token,
      password: PASSWORD,
    });
    expect(ok.status).toBe(200);
    expect(t.panelStore.admin.findUser("dr.obraztsova")).toMatchObject({
      role: "doctor",
      doctorId: "obraztsova",
    });
    const again = await t.request("", "POST", "invite/accept", {
      token,
      password: PASSWORD,
    });
    expect(again.status).toBe(404);
    // Принятие приглашения — тоже только со своего сайта.
    const foreign = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/invite/accept`, {
        method: "POST",
        headers: {
          host: HOST,
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ token, password: PASSWORD }),
      }),
      ["invite", "accept"],
      t.deps,
    );
    expect(foreign.status).toBe(403);
  });

  it("нельзя оставить панель без владельца", async () => {
    const t = await setup();
    const hash = await hashPassword(PASSWORD);
    t.panelStore.admin.createUser("owner2", hash, NOW.toISOString(), "owner");
    const owner = await t.as("owner");
    const owner2 = t.panelStore.admin.findUser("owner2")!;
    // Второго владельца можно понизить — первый остаётся.
    expect(
      (await owner("PATCH", `staff/${owner2.id}`, { role: "admin" })).status,
    ).toBe(200);
    // Себя — нельзя (последний владелец).
    const me = t.panelStore.admin.findUser("owner")!;
    expect(
      (await owner("PATCH", `staff/${me.id}`, { disabled: true })).status,
    ).toBe(409);
    expect(t.panelStore.admin.countActiveOwners()).toBe(1);
  });
});

describe("5. медицинские данные не попадают в уведомления и журналы", () => {
  it("уведомление администратору — только ссылка на диалог", async () => {
    const sent: Record<string, unknown>[] = [];
    const api = {
      call: async (_method: string, params: Record<string, unknown>) => {
        sent.push(params);
        return 1;
      },
    } as unknown as ConstructorParameters<typeof VkAdminNotifier>[0];
    const notifier = new VkAdminNotifier(api, 242364009, 1);
    await notifier.notifyHandoff(PEER);
    const message = String(sent[0]?.message ?? "");
    expect(message).toMatch(/vk\.com\/gim242364009\?sel=7/);
    expect(message).not.toMatch(/колен|бол|жалоб/i);
  });

  it("журналы, аудит и уведомления после разговора, записи, передачи и handoff", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    await t.share(replies);
    const r = await t.say("Позовите администратора");
    await t.press(r, "Да, позвать");
    expect(t.notices).toEqual([PEER]);
    const maketov = await t.as("dr-maketov");
    await maketov("GET", `my/${booking.id}/medical`);
    // Ошибочный запрос к API тоже не пишет тело в журнал.
    const admin = await t.as("admin");
    await admin("POST", "bookings", { doctorId: "x", note: "болит колено" });

    const everything = JSON.stringify({
      logs: t.logs,
      audit: t.panelStore.admin.listAudit(500),
      access: t.panelStore.consents.listAccessLog(500),
      stats: t.panelStore.readStats("2026-01-01"),
    });
    expect(everything).not.toMatch(/колен|ноет|четыре|суставы/);
  });

  it("разговор и согласие в базе зашифрованы; без ключа не читаются", async () => {
    const path = tempDb();
    const { bot, store } = createDemoBot({
      dbPath: path,
      now: () => NOW,
      cipher: MedicalCipher.fromBase64(KEY),
    });
    cleanups.push(() => store.close());
    await bot.handle(PEER, { type: "text", text: COMPLAINT });
    const raw = new DatabaseSync(path);
    cleanups.push(() => raw.close());
    const row = raw
      .prepare("SELECT state FROM sessions WHERE peer_id = ?")
      .get(PEER) as { state: string };
    expect(row.state).toMatch(/^enc:v1:/);
    expect(row.state).not.toMatch(/колен/);
    // Другой ключ или чужой контекст — не расшифровывается.
    const other = MedicalCipher.fromBase64(MedicalCipher.generateKey());
    expect(other.decrypt(row.state, `session:${PEER}`)).toBeUndefined();
    expect(
      MedicalCipher.fromBase64(KEY).decrypt(row.state, "session:8"),
    ).toBeUndefined();
    expect(
      MedicalCipher.fromBase64(KEY).decrypt(row.state, `session:${PEER}`),
    ).toMatch(/колен/);
    // Без ключа зашифрованный разговор просто начинается заново.
    const noKey = new SqliteStore(path);
    cleanups.push(() => noKey.close());
    expect(noKey.load(PEER)).toBeUndefined();
    expect(() => MedicalCipher.fromBase64("короткий")).toThrow();
  });
});

describe("6. существующая учётная запись сохраняет доступ после миграции", () => {
  it("база v5 → v6: администратор становится владельцем, пароль и сессия работают", async () => {
    const path = tempDb();
    const hash = await hashPassword(PASSWORD);
    // Готовим базу версии 5 (как на VPS после a27d677): создаём новую и
    // убираем всё, что добавила миграция 6.
    const fresh = new SqliteStore(path);
    fresh.admin.createUser("vps-admin", hash, NOW.toISOString(), "admin");
    fresh.insert({
      peerId: 11,
      doctorId: "maketov",
      date: "2026-10-20",
      time: "09:00",
      createdAt: NOW.toISOString(),
    });
    fresh.close();
    const db = new DatabaseSync(path);
    db.exec(`
      DROP INDEX admin_users_doctor;
      ALTER TABLE admin_users DROP COLUMN role;
      ALTER TABLE admin_users DROP COLUMN doctor_id;
      DROP TABLE staff_invites;
      DROP TABLE disclosure_consents;
      DROP TABLE medical_access_log;
      PRAGMA user_version = 5;
    `);
    // Сессия, открытая до обновления.
    const auth5 = { token: "x".repeat(43) };
    const { hashToken } = await import("@/admin/auth");
    db.prepare(
      "INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, 1, ?, ?, ?)",
    ).run(
      hashToken(auth5.token),
      NOW.toISOString(),
      new Date(NOW.getTime() + 3_600_000).toISOString(),
      NOW.toISOString(),
    );
    db.close();

    const store = new SqliteStore(path);
    cleanups.push(() => store.close());
    expect(store.schemaVersion).toBe(SCHEMA_VERSION);
    const user = store.admin.findUser("vps-admin")!;
    expect(user).toMatchObject({ role: "owner", doctorId: null });
    expect(user.passwordHash).toBe(hash);
    expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(true);
    // Записи на месте, согласий нет.
    expect(store.searchBookings({})).toHaveLength(1);
    expect(store.consents.countActive("doctor", NOW.toISOString())).toBe(0);
    const auth = new AdminAuth(store.admin, () => NOW);
    expect(auth.verify(auth5.token)).toMatchObject({
      login: "vps-admin",
      role: "owner",
    });
    expect((await auth.login("vps-admin", PASSWORD, "c")).ok).toBe(true);
  });
});

describe("7. бот по-прежнему записывает пациентов", () => {
  it("с шифрованием: жалоба → вопросы → запись; без ключа — тоже", async () => {
    for (const cipher of [true, false]) {
      const t = await setup({ cipher });
      const { replies } = await t.bookKnee();
      // Без ключа передачи нет — кнопка не показывается.
      expect(labels(replies).includes("Передать врачу описание")).toBe(cipher);
      expect(text(replies)).toMatch(/Запись №\d+ подтверждена/);
    }
  });

  it("приветствие честно предупреждает о видимости переписки во ВКонтакте", async () => {
    const t = await setup();
    const r = await t.bot.handle(PEER, { type: "start" });
    expect(text(r)).toContain(PRIVACY_NOTICE);
    expect(PRIVACY_NOTICE).toMatch(/администраторы сообщества ВКонтакте/);
  });

  it("режим без вопросов о симптомах сразу предлагает специалиста", async () => {
    const path = tempDb();
    const { bot, store } = createDemoBot({
      dbPath: path,
      now: () => NOW,
      medicalQuestions: false,
    });
    cleanups.push(() => store.close());
    const r = await bot.handle(PEER, { type: "text", text: COMPLAINT });
    expect(text(r)).toMatch(/травматологу-ортопеду/);
    expect(text(r)).not.toMatch(/после травмы/);
  });
});

describe("8. одновременная запись", () => {
  it("бот (с шифрованием) и панель на один слот: ровно одна запись", async () => {
    const t = await setup();
    const botSchedule = new ClinicSchedule(
      () => t.store.clinic.load(),
      t.store,
      () => NOW,
    );
    const results = await Promise.all([
      Promise.resolve(
        botSchedule.book(PEER, "testova", "2026-10-21", "09:00").status,
      ),
      t.as("admin").then((admin) =>
        admin("POST", "bookings", {
          doctorId: "testova",
          date: "2026-10-21",
          time: "09:00",
        }).then((r) => (r.status === 200 ? "ok" : "taken")),
      ),
    ]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(
      t.panelStore
        .searchBookings({
          doctorId: "testova",
          from: "2026-10-21",
          to: "2026-10-21",
        })
        .filter((b) => b.time === "09:00" && b.status === "confirmed"),
    ).toHaveLength(1);
  });
});

describe("9. по умолчанию согласий на раскрытие нет", () => {
  it("запись с жалобой не создаёт согласия; предложение без нажатия ничего не передаёт", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    expect(text(replies)).toMatch(/необязательно/);
    expect(t.panelStore.consents.countActive("doctor", NOW.toISOString())).toBe(
      0,
    );
    expect(t.panelStore.consents.countActive("admin", NOW.toISOString())).toBe(
      0,
    );
    // Предпросмотр — тоже ещё не согласие.
    const preview = await t.press(replies, "Передать врачу описание");
    expect(text(preview)).toContain(`«${COMPLAINT}»`);
    expect(text(preview)).toMatch(/Получатель — только врач этой записи/);
    expect(t.panelStore.consents.countActive("doctor", NOW.toISOString())).toBe(
      0,
    );
    // Отказ — ничего не передано, предложение удалено.
    const no = await t.press(preview, "Не передавать");
    expect(text(no)).toMatch(/ничего не передаём/);
    expect(t.panelStore.consents.countActive("doctor", NOW.toISOString())).toBe(
      0,
    );
    const session = parseSession(t.store.load(PEER)?.state);
    expect(session.conv.shareOffer).toBeUndefined();
    const maketov = await t.as("dr-maketov");
    expect((await maketov("GET", `my/${booking.id}/medical`)).status).toBe(404);
    // Старая кнопка предпросмотра больше не работает.
    const stale = await t.press(replies, "Передать врачу описание");
    expect(text(stale)).toMatch(/устарело/);
  });

  it("отзыв из «Мои записи» и отмена записи удаляют сведения", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    const { done } = await t.share(replies);
    expect(text(done)).toMatch(/передано врачу записи/);
    const maketov = await t.as("dr-maketov");
    expect((await maketov("GET", `my/${booking.id}/medical`)).status).toBe(200);

    let r = await t.say("Мои записи");
    expect(text(r)).toMatch(/врачу передано описание жалобы/);
    r = await t.press(r, `Отозвать сведения №${booking.id}`);
    expect(text(r)).toMatch(/отозвано/);
    expect((await maketov("GET", `my/${booking.id}/medical`)).status).toBe(404);
    const raw = new DatabaseSync(t.path);
    cleanups.push(() => raw.close());
    const payloads = raw
      .prepare("SELECT payload FROM disclosure_consents")
      .all() as { payload: string | null }[];
    expect(payloads.every((p) => p.payload === null)).toBe(true);

    // Новое согласие и отмена записи пациентом.
    const t2 = await setup();
    const second = await t2.bookKnee();
    await t2.share(second.replies);
    let m = await t2.say("Мои записи");
    m = await t2.press(m, `Отменить №${second.booking.id}`);
    m = await t2.press(m, "Да, отменить");
    expect(text(m)).toMatch(/отменена/);
    expect(
      t2.panelStore.consents.countActive("doctor", NOW.toISOString()),
    ).toBe(0);
  });

  it("истёкшие согласия удаляются", async () => {
    const t = await setup();
    const { replies, booking } = await t.bookKnee();
    await t.share(replies);
    const later = new Date("2026-11-30T00:00:00Z").toISOString();
    expect(t.panelStore.consents.purgeExpired(later)).toBe(1);
    expect(
      t.panelStore.consents.readForDoctor(booking.id, "maketov", later),
    ).toBeUndefined();
  });
});

describe("10. передача администратору не обходит ограничения", () => {
  it("handoff предупреждает о видимости переписки и не создаёт доступа в панели", async () => {
    const t = await setup();
    await t.bookKnee();
    let r = await t.say("Позовите администратора");
    expect(text(r)).toContain(HANDOFF_QUESTION);
    expect(text(r)).toMatch(/увидит всю переписку этого диалога ВКонтакте/);
    r = await t.press(r, "Да, позвать");
    expect(t.notices).toEqual([PEER]);
    // В панели у администратора медицинских сведений не прибавилось.
    expect(t.panelStore.consents.countActive("admin", NOW.toISOString())).toBe(
      0,
    );
    const admin = await t.as("admin");
    for (const path of ["bookings", "dashboard"]) {
      const res = await admin("GET", path);
      expect(res.text).not.toMatch(/колен|ноет|четыре/);
    }
    // Бот молчит, пока отвечает администратор (как и раньше).
    expect(await t.say("ещё вопрос")).toEqual([]);
  });
});
