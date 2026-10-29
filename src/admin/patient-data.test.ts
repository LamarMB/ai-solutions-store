import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAdminApi, type AdminApiDeps } from "@/admin/api";
import { AdminAuth, type AuthConfig } from "@/admin/auth";
import { hashPassword } from "@/admin/password";
import { AdminService } from "@/admin/service";
import { createDemoBot } from "@/bot";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import { SqliteStore } from "@/bot/storage/sqlite";

/**
 * Данные пациента по VK ID (P0-11): выгрузка, удаление с предпросмотром и
 * подтверждением, права, изоляция пациентов и клиник, откат при сбое, журнал
 * без персональных данных. Все данные — вымышленные, базы — временные.
 */

const NOW = new Date("2026-10-19T06:00:00Z");
const HOST = "clinic.example";
const ORIGIN = `https://${HOST}`;
const PASSWORD = "надёжный-пароль-2026";
const KEY = MedicalCipher.generateKey();
const config: AuthConfig = { secureCookie: true, allowedOrigins: [] };
const PATIENT = 501_234_567;
const OTHER = 501_999_888;
const COMPLAINT = "болит колено после падения";
const REQUEST_TEXT = "Прошу перезвонить по поводу записи";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  while (cleanups.length) cleanups.pop()!();
});

/** Ответ API в тестах: поля поиска, выгрузки и удаления. */
type Data = {
  token: string;
  found: boolean;
  vkId: number;
  counts: Record<string, number>;
  retained: { category: string; count?: number }[];
  withheld: { category: string }[];
  deleted: Record<string, number>;
  data: { bookings: { id: number }[] } & Record<string, unknown>;
};

/** Клиника: бот и панель — разные подключения к одной временной базе. */
async function clinic() {
  const dir = mkdtempSync(join(tmpdir(), "patient-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "bot.sqlite");
  const cipher = MedicalCipher.fromBase64(KEY);
  const { bot, store, schedule } = createDemoBot({
    dbPath: path,
    now: () => NOW,
    cipher,
  });
  const panel = new SqliteStore(path, { cipher });
  cleanups.push(() => {
    store.close();
    panel.close();
  });
  const hash = await hashPassword(PASSWORD);
  panel.admin.createUser("owner", hash, NOW.toISOString(), "owner");
  panel.admin.createUser("admin", hash, NOW.toISOString(), "admin");
  panel.admin.createUser("dr", hash, NOW.toISOString(), "doctor", "testova");
  const logs: string[] = [];
  const deps: AdminApiDeps = {
    service: new AdminService(panel, () => NOW),
    auth: new AdminAuth(panel.admin, () => NOW),
    config,
    clientKey: () => "client",
    log: (m) => logs.push(m),
  };
  const call = async (cookie: string, path: string, body: unknown) => {
    const response = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/${path}`, {
        method: "POST",
        headers: {
          host: HOST,
          origin: ORIGIN,
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
      path.split("/"),
      deps,
    );
    return {
      status: response.status,
      json: (await response.json()) as {
        ok: boolean;
        data: Data;
        error?: string;
      },
    };
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
    return (path: string, body: unknown) => call(cookie, path, body);
  };

  /** Пациент: разговор, две записи (прошлая и будущая), согласие, обращение, служебные отметки. */
  async function seed(peer: number, time = "10:00") {
    await bot.handle(peer, { type: "text", text: COMPLAINT });
    // Прошедший приём расписание не создаёт — вставляем как в базе после визита.
    const raw = new DatabaseSync(path);
    const pastId = Number(
      raw
        .prepare(
          "INSERT INTO bookings (peer_id, doctor_id, date, time, created_at, status, source) VALUES (?, 'testova', '2026-10-14', ?, '2026-10-10T08:00:00Z', 'completed', 'vk')",
        )
        .run(peer, time).lastInsertRowid,
    );
    raw.close();
    const future = schedule.book(peer, "testova", "2026-10-21", time);
    if (future.status !== "ok") throw new Error("booking");
    store.consents.grantToDoctor({
      bookingId: future.booking.id,
      peerId: peer,
      doctorId: "testova",
      summary: {
        area: "суставы",
        summary: COMPLAINT,
        redFlags: [],
        redFlagsDenied: true,
      },
      at: NOW.toISOString(),
      expiresAt: "2026-11-30T00:00:00Z",
    });
    store.consents.logAccess({
      userId: 3,
      consentId: null,
      bookingId: future.booking.id,
      action: "read",
      result: "ok",
      at: NOW.toISOString(),
    });
    const request = store.requests.create(
      peer,
      REQUEST_TEXT,
      NOW.toISOString(),
    );
    store.requests.logAccess({
      userId: 2,
      requestId: request.id,
      action: "read",
      result: "ok",
      at: NOW.toISOString(),
    });
    store.setPausedUntil(peer, "2026-10-19T18:00:00Z");
    store.setNoticeAt(peer, "privacy", NOW.toISOString());
    store.markEventProcessed(`mn:${peer}:77`, NOW.toISOString());
    return { past: pastId, future: future.booking.id };
  }
  return { path, bot, store, panel, schedule, deps, logs, as, seed };
}

/** Строки базы, где встречается VK ID пациента (во всех таблицах и столбцах). */
function mentions(path: string, peer: number): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    const found: string[] = [];
    for (const table of tables) {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all())
        if (JSON.stringify(row).includes(String(peer))) found.push(table);
    }
    return found;
  } finally {
    db.close();
  }
}

describe("выгрузка данных пациента", () => {
  it("все хранимые категории; медицинское содержимое — только факт хранения", async () => {
    const c = await clinic();
    const ids = await c.seed(PATIENT);
    await c.seed(OTHER, "11:00");
    const owner = await c.as("owner");

    const search = await owner("patients/search", { vkId: String(PATIENT) });
    expect(search.status).toBe(200);
    expect(search.json.data).toMatchObject({
      vkId: PATIENT,
      found: true,
      counts: {
        bookings: 2,
        upcomingBookings: 1,
        conversation: 1,
        consents: 1,
        requests: 1,
        pause: 1,
        notices: 1,
        processedEvents: 1,
      },
    });

    const r = await owner("patients/export", { vkId: String(PATIENT) });
    expect(r.status).toBe(200);
    const exported = r.json.data;
    expect(exported).toMatchObject({
      format: "demo-med-patient-data",
      vkId: PATIENT,
      data: {
        conversation: { stored: true },
        consents: [
          {
            bookingId: ids.future,
            recipientRole: "doctor",
            status: "granted",
            contentStored: true,
          },
        ],
        requests: [{ consentStatus: "granted", textStored: true }],
        technical: {
          botPausedUntil: "2026-10-19T18:00:00Z",
          notices: [{ kind: "privacy" }],
        },
      },
    });
    expect(exported.data.bookings.map((b: { id: number }) => b.id)).toEqual([
      ids.past,
      ids.future,
    ]);
    expect(exported.data.bookings[0]).toMatchObject({
      doctorName: "Анна Тестова",
      date: "2026-10-14",
    });
    expect(
      exported.withheld.map((w: { category: string }) => w.category),
    ).toHaveLength(3);

    // Медицинские сведения и тексты обращений в выгрузку не попадают; другой пациент — тоже.
    const text = JSON.stringify(exported);
    for (const secret of [COMPLAINT, "колено", REQUEST_TEXT, String(OTHER)])
      expect(text).not.toContain(secret);

    // Журнал: только факт выгрузки, без VK ID.
    const audit = c.panel.admin.listAudit(10);
    expect(audit[0]).toMatchObject({
      action: "patient_export",
      entity: "patient",
      entityId: null,
    });
  });

  it("отсутствующий и неверный VK ID", async () => {
    const c = await clinic();
    const owner = await c.as("owner");
    const none = await owner("patients/search", { vkId: "777000111" });
    expect(none.status).toBe(200);
    expect(none.json.data).toMatchObject({
      found: false,
      counts: { bookings: 0 },
    });
    expect((await owner("patients/export", { vkId: "777000111" })).status).toBe(
      404,
    );
    expect(
      (
        await owner("patients/erase", {
          vkId: "777000111",
          confirm: "777000111",
          token: none.json.data.token,
        })
      ).status,
    ).toBe(404);
    for (const bad of [
      "",
      "abc",
      "-5",
      "0",
      "1.5",
      "12 34",
      "9007199254740993",
    ]) {
      const r = await owner("patients/search", { vkId: bad });
      expect(r.status, bad).toBe(400);
      expect(r.json.error).toMatch(/VK ID — положительное число/);
    }
    // Записи из панели (без VK ID, peer 0) не ищутся как пациент.
    expect((await owner("patients/search", { vkId: "0" })).status).toBe(400);
  });
});

describe("удаление данных пациента", () => {
  it("предпросмотр → подтверждение → удаление; остатков в базе нет; другой пациент цел; журналы с номерами сохраняются", async () => {
    const c = await clinic();
    await c.seed(PATIENT);
    await c.seed(OTHER, "11:00");
    const owner = await c.as("owner");
    const otherBefore = await owner("patients/search", { vkId: String(OTHER) });

    const preview = (await owner("patients/search", { vkId: String(PATIENT) }))
      .json.data;
    expect(
      preview.retained.map((r: { category: string; count?: number }) => [
        r.category,
        r.count,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["Журнал доступа к сведениям для врача", 1],
        ["Журнал открытия обращений", 1],
        ["Зашифрованные резервные копии базы", undefined],
        ["Переписка в сообщениях сообщества ВКонтакте", undefined],
      ]),
    );
    expect(mentions(c.path, PATIENT).length).toBeGreaterThan(0);

    const r = await owner("patients/erase", {
      vkId: String(PATIENT),
      confirm: String(PATIENT),
      token: preview.token,
    });
    expect(r.status).toBe(200);
    expect(r.json.data.deleted).toMatchObject({
      bookings: 2,
      consents: 1,
      requests: 1,
      conversation: 1,
    });

    // Ни одной строки с VK ID пациента ни в одной таблице.
    expect(mentions(c.path, PATIENT)).toEqual([]);
    expect(
      (await owner("patients/search", { vkId: String(PATIENT) })).json.data
        .found,
    ).toBe(false);
    // Будущий слот освобождён.
    expect(c.schedule.listFreeSlots("testova", "2026-10-21")).toContain(
      "10:00",
    );
    // Другой пациент — без изменений.
    expect(
      (await owner("patients/search", { vkId: String(OTHER) })).json.data,
    ).toEqual(otherBefore.json.data);
    // Журналы доступа (номера записей и обращений) сохранены.
    expect(c.store.consents.listAccessLog()).toHaveLength(2);
    expect(c.store.requests.listAccessLog()).toHaveLength(2);
  });

  it("отмена и неверное подтверждение — ничего не удаляется", async () => {
    const c = await clinic();
    await c.seed(PATIENT);
    const owner = await c.as("owner");
    const preview = (await owner("patients/search", { vkId: String(PATIENT) }))
      .json.data;
    const before = mentions(c.path, PATIENT);
    // «Не удалять» — запрос не отправляется; неверный или пустой VK ID при подтверждении — отказ.
    for (const confirm of ["", String(PATIENT + 1), "да"]) {
      const r = await owner("patients/erase", {
        vkId: String(PATIENT),
        confirm,
        token: preview.token,
      });
      expect(r.status).toBe(400);
      expect(r.json.error).toMatch(/введите VK ID пациента ещё раз/);
    }
    // Данные изменились после предпросмотра (новая запись) — отказ.
    c.schedule.book(PATIENT, "testova", "2026-10-23", "14:00");
    const stale = await owner("patients/erase", {
      vkId: String(PATIENT),
      confirm: String(PATIENT),
      token: preview.token,
    });
    expect(stale.status).toBe(409);
    expect(mentions(c.path, PATIENT)).toEqual(expect.arrayContaining(before));
    expect(
      c.panel.admin.listAudit(20).some((a) => a.action === "patient_erase"),
    ).toBe(false);
  });

  it("сбой посреди удаления — откат, данные целы", async () => {
    const c = await clinic();
    await c.seed(PATIENT);
    const owner = await c.as("owner");
    const preview = (await owner("patients/search", { vkId: String(PATIENT) }))
      .json.data;
    // Сбой базы на удалении записей — после удаления согласий и обращений в той же транзакции.
    const db = new DatabaseSync(c.path);
    db.exec(
      "CREATE TRIGGER fail_erase BEFORE DELETE ON bookings BEGIN SELECT RAISE(ABORT, 'test'); END;",
    );
    db.close();
    const r = await owner("patients/erase", {
      vkId: String(PATIENT),
      confirm: String(PATIENT),
      token: preview.token,
    });
    expect(r.status).toBe(500);
    expect(
      (await owner("patients/search", { vkId: String(PATIENT) })).json.data
        .counts,
    ).toEqual(preview.counts);
    // В журнале сервера — ни VK ID, ни подробностей.
    expect(c.logs.join("\n")).not.toContain(String(PATIENT));
  });
});

describe("права, журнал и изоляция клиник", () => {
  it("только владелец; администратор и врач — 403, без входа — 401", async () => {
    const c = await clinic();
    await c.seed(PATIENT);
    for (const login of ["admin", "dr"]) {
      const user = await c.as(login);
      for (const path of [
        "patients/search",
        "patients/export",
        "patients/erase",
      ])
        expect(
          (
            await user(path, {
              vkId: String(PATIENT),
              confirm: String(PATIENT),
            })
          ).status,
        ).toBe(403);
    }
    const anonymous = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/patients/search`, {
        method: "POST",
        headers: {
          host: HOST,
          origin: ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ vkId: String(PATIENT) }),
      }),
      ["patients", "search"],
      c.deps,
    );
    expect(anonymous.status).toBe(401);
    expect(mentions(c.path, PATIENT).length).toBeGreaterThan(0);
  });

  it("журнал действий и журнал сервера — без VK ID и содержимого", async () => {
    const c = await clinic();
    await c.seed(PATIENT);
    const owner = await c.as("owner");
    const preview = (await owner("patients/search", { vkId: String(PATIENT) }))
      .json.data;
    await owner("patients/export", { vkId: String(PATIENT) });
    await owner("patients/erase", {
      vkId: String(PATIENT),
      confirm: String(PATIENT),
      token: preview.token,
    });
    const audit = c.panel.admin
      .listAudit(20)
      .filter((a) => a.entity === "patient");
    expect(audit.map((a) => a.action)).toEqual([
      "patient_erase",
      "patient_export",
    ]);
    expect(audit[0].entityId).toBe(
      "bookings:2,upcomingBookings:1,conversation:1,consents:1,requests:1,pause:1,notices:1,processedEvents:1",
    );
    const all = JSON.stringify(audit) + c.logs.join("\n");
    for (const secret of [String(PATIENT), COMPLAINT, REQUEST_TEXT])
      expect(all).not.toContain(secret);
  });

  it("клиника видит и удаляет только свою базу: тот же VK ID в другой клинике не затронут", async () => {
    const a = await clinic();
    const b = await clinic();
    await a.seed(PATIENT);
    await b.seed(PATIENT);
    const ownerA = await a.as("owner");
    const preview = (await ownerA("patients/search", { vkId: String(PATIENT) }))
      .json.data;
    await ownerA("patients/erase", {
      vkId: String(PATIENT),
      confirm: String(PATIENT),
      token: preview.token,
    });
    expect(mentions(a.path, PATIENT)).toEqual([]);
    expect(mentions(b.path, PATIENT).length).toBeGreaterThan(0);
    const ownerB = await b.as("owner");
    expect(
      (await ownerB("patients/search", { vkId: String(PATIENT) })).json.data
        .counts.bookings,
    ).toBe(2);
  });
});
