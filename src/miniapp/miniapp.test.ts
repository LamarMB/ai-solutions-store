import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AdminService } from "@/admin/service";
import { createDemoBot } from "@/bot";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import { SCHEMA_VERSION, SqliteStore } from "@/bot/storage/sqlite";
import {
  handleMiniAppApi,
  LAUNCH_HEADER,
  type MiniAppApiDeps,
} from "@/miniapp/api";
import { miniAppConfigFromEnv, type MiniAppConfig } from "@/miniapp/config";
import { signLaunchParams, verifyLaunchParams } from "@/miniapp/launch-params";
import { MiniAppService } from "@/miniapp/service";

/*
 * VK Mini App: подпись параметров запуска, доступ только к своим записям,
 * общая база с ботом и админ-панелью. Только вымышленные данные и VK ID.
 */

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const APP_ID = 51000001;
const SECRET = "test-secret-not-real-1";
const ALICE = 1001;
const BOB = 1002;
const STRANGER = 1003;
const config: MiniAppConfig = {
  appId: APP_ID,
  secret: SECRET,
  allowedUserIds: new Set([ALICE, BOB]),
  groupId: 242364009,
  maxAgeSeconds: 24 * 3600,
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "miniapp-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "bot.sqlite");
}

/** Параметры запуска, подписанные «как ВКонтакте». */
function launch(
  userId: number,
  over: Record<string, string> = {},
  secret = SECRET,
): string {
  const params: Record<string, string> = {
    vk_access_token_settings: "",
    vk_app_id: String(APP_ID),
    vk_are_notifications_enabled: "0",
    vk_is_app_user: "1",
    vk_language: "ru",
    vk_platform: "mobile_android",
    vk_ts: String(Math.floor(NOW.getTime() / 1000) - 60),
    vk_user_id: String(userId),
    ...over,
  };
  const sign = signLaunchParams(params, secret);
  return new URLSearchParams({ ...params, sign }).toString();
}

type Json = { ok: boolean; data?: unknown; code?: string; error?: string };

function setup(path = tempDb()) {
  const store = new SqliteStore(path);
  cleanups.push(() => store.close());
  let now = NOW;
  const clock = () => now;
  const deps: MiniAppApiDeps = {
    service: new MiniAppService(store, clock),
    config,
    now: clock,
  };
  const request = async (
    headers: Record<string, string>,
    method: string,
    route: string,
    body?: unknown,
    rawBody?: string,
  ) => {
    const url = new URL(`https://clinic.example/api/miniapp/${route}`);
    const response = await handleMiniAppApi(
      new Request(url, {
        method,
        headers: {
          ...(body !== undefined || rawBody !== undefined
            ? { "content-type": "application/json" }
            : {}),
          ...headers,
        },
        body:
          rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
      }),
      url.pathname.replace("/api/miniapp/", "").split("/").filter(Boolean),
      deps,
    );
    const json = (await response.json()) as Json;
    return { status: response.status, json, text: JSON.stringify(json) };
  };
  /** Запросы от имени пациента с корректной подписью. */
  const as =
    (userId: number) => (method: string, route: string, body?: unknown) =>
      request({ [LAUNCH_HEADER]: launch(userId) }, method, route, body);
  return {
    path,
    store,
    deps,
    request,
    as,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const SLOT = { doctorId: "testova", date: "2026-10-21", time: "09:00" };

describe("подпись параметров запуска VK", () => {
  it("официальный пример VKCOM/vk-apps-launch-params проходит проверку", () => {
    // examples/node.js: адрес и защищённый ключ из документации ВКонтакте.
    const url =
      "https://example.com/?vk_user_id=494075&vk_app_id=6736218&vk_is_app_user=1&vk_are_notifications_enabled=1&vk_language=ru&vk_access_token_settings=&vk_platform=android&sign=htQFduJpLxz7ribXRZpDFUH-XEUhC9rBPTJkjUFEkRA";
    const result = verifyLaunchParams(url.slice(url.indexOf("?")), {
      secret: "wvl68m4dR1UpLrVRli",
      appId: 6736218,
    });
    expect(result).toEqual({
      ok: true,
      params: { userId: 494075, appId: 6736218, platform: "android" },
    });
  });

  it("подмена VK ID, другой ключ, чужое приложение, повтор параметра, срок", () => {
    const opts = {
      secret: SECRET,
      appId: APP_ID,
      now: () => NOW,
      maxAgeSeconds: 3600,
    };
    const good = launch(ALICE);
    expect(verifyLaunchParams(good, opts)).toMatchObject({
      ok: true,
      params: { userId: ALICE },
    });
    // Подмена VK ID в подписанной строке.
    expect(
      verifyLaunchParams(
        good.replace(`vk_user_id=${ALICE}`, `vk_user_id=${BOB}`),
        opts,
      ),
    ).toEqual({ ok: false, reason: "bad_sign" });
    // Второй vk_user_id в конце строки.
    expect(verifyLaunchParams(`${good}&vk_user_id=${BOB}`, opts)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      verifyLaunchParams(launch(ALICE, {}, "other-secret-123"), opts),
    ).toEqual({
      ok: false,
      reason: "bad_sign",
    });
    expect(
      verifyLaunchParams(launch(ALICE, { vk_app_id: "999" }), opts),
    ).toEqual({ ok: false, reason: "wrong_app" });
    const old = launch(ALICE, {
      vk_ts: String(Math.floor(NOW.getTime() / 1000) - 7200),
    });
    expect(verifyLaunchParams(old, opts)).toEqual({
      ok: false,
      reason: "expired",
    });
    for (const bad of [null, "", "vk_user_id=1", "sign=abc", "x".repeat(5000)])
      expect(verifyLaunchParams(bad, opts).ok).toBe(false);
    // Параметры не vk_* в подпись не входят и ничего не меняют.
    expect(verifyLaunchParams(`${good}&utm=1`, opts).ok).toBe(true);
  });

  it("настройки: без ID и ключа — ошибки без значений; список доступа — как у бота", () => {
    const bad = miniAppConfigFromEnv({ VK_MINIAPP_SECRET: "short" });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("short");
    const good = miniAppConfigFromEnv({
      VK_MINIAPP_ID: "123",
      VK_MINIAPP_SECRET: "long-enough-secret",
      VK_ALLOWED_USER_IDS: "1, 2",
      VK_GROUP_ID: "242364009",
    });
    expect(good).toMatchObject({
      ok: true,
      config: { appId: 123, groupId: 242364009, maxAgeSeconds: 86400 },
    });
    expect(good.ok && [...good.config.allowedUserIds]).toEqual([1, 2]);
    const own = miniAppConfigFromEnv({
      VK_MINIAPP_ID: "123",
      VK_MINIAPP_SECRET: "long-enough-secret",
      VK_ALLOWED_USER_IDS: "1",
      MINIAPP_ALLOWED_USER_IDS: "7",
    });
    expect(own.ok && [...own.config.allowedUserIds]).toEqual([7]);
  });
});

describe("доступ к API", () => {
  it("без подписи, с неверной подписью, вне списка тестовых аккаунтов — отказ", async () => {
    const t = setup();
    for (const route of ["clinic", "bookings"]) {
      expect((await t.request({}, "GET", route)).status).toBe(401);
      expect(
        (
          await t.request(
            { [LAUNCH_HEADER]: launch(ALICE, {}, "wrong-secret-1") },
            "GET",
            route,
          )
        ).status,
      ).toBe(401);
      // VK ID в адресе или отдельном заголовке ничего не доказывает.
      expect(
        (
          await t.request(
            { "x-vk-user-id": String(ALICE) },
            "GET",
            `${route}?vk_user_id=${ALICE}`,
          )
        ).status,
      ).toBe(401);
    }
    const stranger = await t.as(STRANGER)("GET", "bookings");
    expect(stranger.status).toBe(403);
    expect(stranger.json.code).toBe("not_allowed");
    // Попытка записаться без подписи не создаёт записи.
    expect((await t.request({}, "POST", "bookings", SLOT)).status).toBe(401);
    expect(t.store.searchBookings({})).toHaveLength(0);
  });

  it("устаревшие параметры запуска — понятная ошибка", async () => {
    const t = setup();
    t.advance(25 * 3600 * 1000);
    const r = await t.as(ALICE)("GET", "clinic");
    expect(r.status).toBe(401);
    expect(r.json.code).toBe("expired");
  });

  it("VK ID из тела запроса не принимается", async () => {
    const t = setup();
    const r = await t.as(ALICE)("POST", "bookings", { ...SLOT, peerId: BOB });
    expect(r.status).toBe(400);
    const ok = await t.as(ALICE)("POST", "bookings", SLOT);
    expect(ok.status).toBe(200);
    // Запись принадлежит тому, чья подпись, а не тому, кто указан в теле.
    expect(t.store.searchBookings({})[0].peerId).toBe(ALICE);
  });

  it("ошибки API: формат, неизвестный маршрут, неверные данные, частота", async () => {
    const t = setup();
    const alice = t.as(ALICE);
    const headers = { [LAUNCH_HEADER]: launch(ALICE) };
    expect(
      (await t.request(headers, "POST", "bookings", undefined, "{не json"))
        .status,
    ).toBe(400);
    const noJson = await handleMiniAppApi(
      new Request("https://clinic.example/api/miniapp/bookings", {
        method: "POST",
        headers: { ...headers, "content-type": "text/plain" },
        body: JSON.stringify(SLOT),
      }),
      ["bookings"],
      t.deps,
    );
    expect(noJson.status).toBe(415);
    expect((await alice("GET", "nothing")).status).toBe(404);
    expect((await alice("DELETE", "bookings/1")).status).toBe(404);
    expect((await alice("GET", "doctors/unknown/days")).status).toBe(404);
    expect(
      (await alice("GET", "doctors/testova/slots?date=вчера")).status,
    ).toBe(400);
    expect(
      (await alice("POST", "bookings", { ...SLOT, time: "25:99" })).status,
    ).toBe(400);
    expect(
      (await alice("POST", "bookings", { ...SLOT, time: "09:10" })).json.code,
    ).toBe("unavailable");
    // Частота: изменения — не больше 20 в минуту.
    let last = 0;
    for (let i = 0; i < 25; i++)
      last = (await alice("PATCH", "bookings/999", { action: "cancel" }))
        .status;
    expect(last).toBe(429);
  });
});

describe("запись, отмена, перенос", () => {
  it("свободные слоты → запись → в «Моих записях» → отмена освобождает слот", async () => {
    const t = setup();
    const alice = t.as(ALICE);
    const days = (await alice("GET", "doctors/testova/days")).json
      .data as string[];
    expect(days).toContain("2026-10-21");
    let slots = (await alice("GET", "doctors/testova/slots?date=2026-10-21"))
      .json.data as string[];
    expect(slots).toContain("09:00");

    const booked = await alice("POST", "bookings", SLOT);
    expect(booked.json.data).toMatchObject({
      date: "2026-10-21",
      time: "09:00",
      status: "confirmed",
      upcoming: true,
      doctorName: "Анна Тестова",
      repeated: false,
    });
    const id = (booked.json.data as { id: number }).id;
    slots = (await alice("GET", "doctors/testova/slots?date=2026-10-21")).json
      .data as string[];
    expect(slots).not.toContain("09:00");
    const mine = (await alice("GET", "bookings")).json.data as {
      upcoming: { id: number }[];
    };
    expect(mine.upcoming.map((b) => b.id)).toEqual([id]);

    const cancelled = await alice("PATCH", `bookings/${id}`, {
      action: "cancel",
    });
    expect(cancelled.json.data).toMatchObject({
      status: "cancelled",
      upcoming: false,
    });
    slots = (await alice("GET", "doctors/testova/slots?date=2026-10-21")).json
      .data as string[];
    expect(slots).toContain("09:00");
    const after = (await alice("GET", "bookings")).json.data as {
      upcoming: unknown[];
      past: { id: number; status: string }[];
    };
    expect(after.upcoming).toHaveLength(0);
    expect(after.past[0]).toMatchObject({ id, status: "cancelled" });
  });

  it("перенос своей записи — по правилам пациента; лимит активных записей", async () => {
    const t = setup();
    const alice = t.as(ALICE);
    const id = (
      (await alice("POST", "bookings", SLOT)).json.data as { id: number }
    ).id;
    const moved = await alice("PATCH", `bookings/${id}`, {
      action: "reschedule",
      doctorId: "testova",
      date: "2026-10-21",
      time: "10:00",
    });
    expect(moved.json.data).toMatchObject({ id, time: "10:00" });
    // Дальше горизонта пациента (14 дней) перенести нельзя, хотя админ может.
    const far = await alice("PATCH", `bookings/${id}`, {
      action: "reschedule",
      doctorId: "testova",
      date: "2026-11-25",
      time: "09:00",
    });
    expect(far.status).toBe(409);
    await alice("POST", "bookings", { ...SLOT, time: "11:00" });
    await alice("POST", "bookings", { ...SLOT, time: "11:30" });
    const fourth = await alice("POST", "bookings", { ...SLOT, time: "12:00" });
    expect(fourth.status).toBe(409);
    expect(fourth.json.code).toBe("limit");
  });

  it("повторные запросы: двойное нажатие и повторная отмена не дают ошибок и дублей", async () => {
    const t = setup();
    const alice = t.as(ALICE);
    const [a, b] = await Promise.all([
      alice("POST", "bookings", SLOT),
      alice("POST", "bookings", SLOT),
    ]);
    const first = a.json.data as { id: number; repeated: boolean };
    const second = b.json.data as { id: number; repeated: boolean };
    expect(first.id).toBe(second.id);
    expect([first.repeated, second.repeated].sort()).toEqual([false, true]);
    expect(t.store.searchBookings({})).toHaveLength(1);
    // Обновление страницы и повтор того же запроса.
    const again = await alice("POST", "bookings", SLOT);
    expect(again.json.data).toMatchObject({ id: first.id, repeated: true });
    const c1 = await alice("PATCH", `bookings/${first.id}`, {
      action: "cancel",
    });
    const c2 = await alice("PATCH", `bookings/${first.id}`, {
      action: "cancel",
    });
    expect([c1.status, c2.status]).toEqual([200, 200]);
    expect(c2.json.data).toMatchObject({ status: "cancelled" });
  });
});

describe("чужие записи", () => {
  it("пациент не видит, не отменяет и не переносит чужую запись", async () => {
    const t = setup();
    const id = (
      (await t.as(ALICE)("POST", "bookings", SLOT)).json.data as { id: number }
    ).id;
    const bob = t.as(BOB);
    const list = await bob("GET", "bookings");
    expect(list.json.data).toEqual({ upcoming: [], past: [] });
    const cancel = await bob("PATCH", `bookings/${id}`, { action: "cancel" });
    const missing = await bob("PATCH", "bookings/99999", { action: "cancel" });
    // Чужая и несуществующая запись — одинаковый ответ.
    expect([cancel.status, cancel.json.error]).toEqual([
      missing.status,
      missing.json.error,
    ]);
    expect(cancel.status).toBe(404);
    const move = await bob("PATCH", `bookings/${id}`, {
      action: "reschedule",
      doctorId: "testova",
      date: "2026-10-21",
      time: "10:00",
    });
    expect(move.status).toBe(404);
    expect(t.store.getBooking(id)).toMatchObject({
      status: "confirmed",
      time: "09:00",
      peerId: ALICE,
    });
    // Занятый чужой записью слот — просто недоступен, без сведений о владельце.
    const taken = await bob("POST", "bookings", SLOT);
    expect(taken.status).toBe(409);
    expect(taken.text).not.toContain(String(ALICE));
  });

  it("ответы не содержат пометок администратора, VK ID и медицинских сведений", async () => {
    const t = setup();
    const admin = new AdminService(t.store, () => NOW);
    const adminBooking = admin.createBooking(
      {
        doctorId: "testova",
        date: "2026-10-21",
        time: "10:00",
        note: "перезвонить вечером",
      },
      1,
    );
    // Запись пациента с пометкой (как если бы администратор её поставил).
    const id = (
      (await t.as(ALICE)("POST", "bookings", SLOT)).json.data as { id: number }
    ).id;
    const raw = new DatabaseSync(t.path);
    cleanups.push(() => raw.close());
    raw
      .prepare("UPDATE bookings SET note = 'служебная пометка' WHERE id = ?")
      .run(id);
    const all = [
      await t.as(ALICE)("GET", "bookings"),
      await t.as(ALICE)("GET", "clinic"),
      await t.as(BOB)("GET", "bookings"),
    ]
      .map((r) => r.text)
      .join("\n");
    expect(all).not.toMatch(/пометк|перезвонить|peerId|"note"|"source"/);
    expect(all).not.toContain(String(ALICE));
    expect(all).not.toContain(`"id":${adminBooking.id},`);
  });
});

describe("одновременная запись", () => {
  it("два пациента в разных процессах на один слот — успешна одна запись", async () => {
    const path = tempDb();
    const a = setup(path);
    const b = setup(path);
    const results = await Promise.all([
      a.as(ALICE)("POST", "bookings", SLOT),
      b.as(BOB)("POST", "bookings", SLOT),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      a.store
        .searchBookings({
          doctorId: "testova",
          from: "2026-10-21",
          to: "2026-10-21",
        })
        .filter((x) => x.time === "09:00" && x.status === "confirmed"),
    ).toHaveLength(1);
  });
});

describe("общая база с ботом и админ-панелью", () => {
  it("Mini App ↔ панель ↔ бот: записи, занятые слоты, врачи, цены, отмена", async () => {
    const path = tempDb();
    const t = setup(path);
    const panelStore = new SqliteStore(path);
    cleanups.push(() => panelStore.close());
    const panel = new AdminService(panelStore, () => NOW);
    const { bot, store: botStore } = createDemoBot({
      dbPath: path,
      now: () => NOW,
      cipher: MedicalCipher.fromBase64(MedicalCipher.generateKey()),
    });
    cleanups.push(() => botStore.close());
    const alice = t.as(ALICE);

    // 1. Запись из Mini App видна в панели с источником «miniapp».
    const id = (
      (await alice("POST", "bookings", SLOT)).json.data as { id: number }
    ).id;
    expect(panel.listBookings({}).find((b) => b.id === id)).toMatchObject({
      source: "miniapp",
      doctorId: "testova",
      date: "2026-10-21",
      time: "09:00",
      status: "confirmed",
    });
    expect(panel.dashboard().week.fromMiniApp).toBe(1);

    // 2. Запись через бота видна в Mini App (тот же VK ID).
    const say = (text: string) => bot.handle(ALICE, { type: "text", text });
    const press = async (
      replies: Awaited<ReturnType<typeof say>>,
      label: string,
    ) =>
      bot.handle(ALICE, {
        type: "action",
        payload: replies
          .flatMap((r) => r.buttons.flat())
          .find((x) => x.label === label)!.action,
      });
    let r = await say("у меня болит колено");
    r = await say("Без травмы");
    r = await say("Уже дня четыре");
    r = await say("Нет, просто иногда ноет");
    r = await press(r, "Ближайшее время");
    r = await say("да");
    expect(r.map((x) => x.text).join()).toMatch(/подтверждена/);
    const mine = (await alice("GET", "bookings")).json.data as {
      upcoming: { doctorId: string; id: number }[];
    };
    expect(mine.upcoming.map((b) => b.doctorId).sort()).toEqual([
      "maketov",
      "testova",
    ]);
    // В ответе Mini App нет жалобы из разговора с ботом.
    expect(JSON.stringify(mine)).not.toMatch(/колен|ноет/);
    // И наоборот: бот показывает запись из Mini App в «Моих записях».
    const botList = await bot.handle(ALICE, {
      type: "action",
      payload: { a: "my" },
    });
    expect(botList.map((x) => x.text).join()).toContain(`№${id}`);

    // 3. Администратор занял слот — Mini App его не предлагает.
    panel.createBooking(
      { doctorId: "testova", date: "2026-10-21", time: "09:30" },
      1,
    );
    const slots = (await alice("GET", "doctors/testova/slots?date=2026-10-21"))
      .json.data as string[];
    expect(slots).not.toContain("09:30");
    expect(
      (await t.as(BOB)("POST", "bookings", { ...SLOT, time: "09:30" })).status,
    ).toBe(409);

    // 5. Врач отключён в панели — исчез из записи.
    panel.updateDoctor("primerov", { active: false }, 1);
    const clinic = (await alice("GET", "clinic")).json.data as {
      doctors: { id: string; priceRub: number | null }[];
      services: { title: string; priceRub: number }[];
    };
    expect(clinic.doctors.map((d) => d.id)).not.toContain("primerov");
    expect((await alice("GET", "doctors/primerov/days")).status).toBe(404);
    expect(
      (
        await t.as(BOB)("POST", "bookings", {
          doctorId: "primerov",
          date: "2026-10-20",
          time: "10:00",
        })
      ).status,
    ).toBe(404);

    // 6. Цена изменена в панели — новая цена в Mini App.
    const doctor = panel.listDoctors().doctors.find((d) => d.id === "testova")!;
    panel.updateDoctor(
      "testova",
      {
        name: doctor.name,
        specialtyId: doctor.specialtyId,
        about: doctor.about,
        slotMinutes: doctor.slotMinutes,
        priceRub: 2750,
      },
      1,
    );
    const updated = (await alice("GET", "clinic")).json.data as typeof clinic;
    expect(updated.doctors.find((d) => d.id === "testova")?.priceRub).toBe(
      2750,
    );
    const myAfter = (await alice("GET", "bookings")).json.data as {
      upcoming: { id: number; priceRub: number }[];
    };
    expect(myAfter.upcoming.find((b) => b.id === id)?.priceRub).toBe(2750);

    // 7. Пациент отменил — слот свободен и для бота, и в панели.
    await alice("PATCH", `bookings/${id}`, { action: "cancel" });
    expect(panel.freeSlots("testova", "2026-10-21")).toContain("09:00");
    expect(panel.listBookings({}).find((b) => b.id === id)?.status).toBe(
      "cancelled",
    );
  });

  it("отмена в Mini App прекращает согласие на передачу сведений врачу", async () => {
    const path = tempDb();
    const t = setup(path);
    const id = (
      (await t.as(ALICE)("POST", "bookings", SLOT)).json.data as { id: number }
    ).id;
    const consents = new SqliteStore(path, {
      cipher: MedicalCipher.fromBase64(MedicalCipher.generateKey()),
    });
    cleanups.push(() => consents.close());
    consents.consents.grantToDoctor({
      bookingId: id,
      peerId: ALICE,
      doctorId: "testova",
      summary: {
        area: "general",
        summary: "тест",
        redFlags: [],
        redFlagsDenied: false,
      },
      at: NOW.toISOString(),
      expiresAt: "2026-11-01T00:00:00.000Z",
    });
    expect(consents.consents.countActive("doctor", NOW.toISOString())).toBe(1);
    await t.as(ALICE)("PATCH", `bookings/${id}`, { action: "cancel" });
    expect(consents.consents.countActive("doctor", NOW.toISOString())).toBe(0);
  });
});

describe("миграции", () => {
  it("база версии 5 (как на VPS) открывается Mini App: схема обновляется, записи на месте", async () => {
    const path = tempDb();
    const fresh = new SqliteStore(path);
    fresh.insert({
      peerId: ALICE,
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
    db.close();

    const t = setup(path);
    expect(t.store.schemaVersion).toBe(SCHEMA_VERSION);
    const mine = (await t.as(ALICE)("GET", "bookings")).json.data as {
      upcoming: { doctorId: string; time: string }[];
    };
    expect(mine.upcoming).toMatchObject([
      { doctorId: "maketov", time: "09:00" },
    ]);
  });
});
