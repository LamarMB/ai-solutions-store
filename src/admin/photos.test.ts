import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { handleAdminApi, type AdminApiDeps } from "@/admin/api";
import { AdminAuth, type AuthConfig } from "@/admin/auth";
import { hashPassword } from "@/admin/password";
import { AdminService } from "@/admin/service";
import {
  bindDemoPhotos,
  DEMO_DOCTOR_PHOTOS,
  DEMO_PHOTOS_DIR,
} from "@/bot/demo-photos";
import type { StaffRole } from "@/bot/storage/admin-store";
import { inspectImage, PHOTO_MAX_BYTES } from "@/bot/storage/image";
import { photoUrl } from "@/bot/storage/photo-store";
import { SCHEMA_VERSION, SqliteStore } from "@/bot/storage/sqlite";
import { handleMiniAppApi, LAUNCH_HEADER } from "@/miniapp/api";
import type { MiniAppConfig } from "@/miniapp/config";
import { signLaunchParams } from "@/miniapp/launch-params";
import { photoResponse } from "@/miniapp/photos";
import { MiniAppService } from "@/miniapp/service";

/*
 * Фотографии врачей: проверка файлов, хранение в общей базе, управление из
 * панели по правам, отображение в Mini App, привязка демо-портретов (созданы
 * ИИ) только к вымышленным врачам. Только вымышленные данные.
 */

// Понедельник, 19 октября 2026, 09:00 по Москве.
const NOW = new Date("2026-10-19T06:00:00Z");
const HOST = "clinic.example";
const ORIGIN = `https://${HOST}`;
const PASSWORD = "надёжный-пароль-2026";
const config: AuthConfig = { secureCookie: true, allowedOrigins: [] };
const DEMO = readFileSync(join(DEMO_PHOTOS_DIR, "anna-testova.webp"));

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "photos-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "bot.sqlite");
}

/** Заголовок PNG нужного размера (для проверки сигнатуры достаточно IHDR). */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/** Минимальный JPEG: SOI, APP0, SOF0 с размерами. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
}

const text = (s: string) => new TextEncoder().encode(s);

async function setup(path = tempDb()) {
  const store = new SqliteStore(path);
  cleanups.push(() => store.close());
  const hash = await hashPassword(PASSWORD);
  const users: [string, StaffRole, string | null][] = [
    ["owner", "owner", null],
    ["admin", "admin", null],
    ["dr-maketov", "doctor", "maketov"],
  ];
  for (const [login, role, doctorId] of users)
    store.admin.createUser(login, hash, NOW.toISOString(), role, doctorId);
  const deps: AdminApiDeps = {
    service: new AdminService(store, () => NOW),
    auth: new AdminAuth(store.admin, () => NOW),
    config,
    clientKey: () => "client-1",
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
    return async (
      method: string,
      route: string,
      body?: Uint8Array,
      headers: Record<string, string> = {},
    ) => {
      const url = new URL(`${ORIGIN}/api/admin/${route}`);
      const response = await handleAdminApi(
        new Request(url, {
          method,
          headers: {
            host: HOST,
            cookie,
            ...(method !== "GET" ? { origin: ORIGIN } : {}),
            ...headers,
          },
          body: body as BodyInit | undefined,
        }),
        url.pathname.replace("/api/admin/", "").split("/").filter(Boolean),
        deps,
      );
      return {
        status: response.status,
        json: (await response.json()) as {
          ok: boolean;
          data?: unknown;
          error?: string;
        },
      };
    };
  };
  return { path, store, deps, as };
}

describe("проверка изображений по содержимому", () => {
  it("принимает JPEG, PNG и WebP с размерами; читает стороны", () => {
    expect(inspectImage(DEMO)).toEqual({
      ok: true,
      info: { type: "image/webp", width: 480, height: 480 },
    });
    expect(inspectImage(png(800, 600))).toEqual({
      ok: true,
      info: { type: "image/png", width: 800, height: 600 },
    });
    expect(inspectImage(jpeg(640, 640))).toEqual({
      ok: true,
      info: { type: "image/jpeg", width: 640, height: 640 },
    });
  });

  it("отклоняет SVG, HTML, GIF, пустые, огромные, крошечные и анимированные", () => {
    const svg = text(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    );
    const html = text("<html><script>alert(1)</script></html>");
    const gif = text("GIF89a\x01\x00\x01\x00");
    expect(inspectImage(svg)).toEqual({ ok: false, problem: "type" });
    expect(inspectImage(html)).toEqual({ ok: false, problem: "type" });
    expect(inspectImage(gif)).toEqual({ ok: false, problem: "type" });
    expect(inspectImage(new Uint8Array())).toEqual({
      ok: false,
      problem: "size",
    });
    expect(inspectImage(new Uint8Array(PHOTO_MAX_BYTES + 1))).toEqual({
      ok: false,
      problem: "size",
    });
    expect(inspectImage(png(50, 50))).toEqual({
      ok: false,
      problem: "dimensions",
    });
    expect(inspectImage(png(5000, 300))).toEqual({
      ok: false,
      problem: "dimensions",
    });
    // WebP VP8X с флагом анимации.
    const anim = new Uint8Array(40);
    anim.set(text("RIFF"), 0);
    anim.set(text("WEBPVP8X"), 8);
    anim[20] = 0x02;
    anim.set([0xff, 0x01, 0x00, 0xff, 0x01, 0x00], 24);
    expect(inspectImage(anim)).toEqual({ ok: false, problem: "animated" });
  });
});

describe("демо-портреты (созданы ИИ)", () => {
  it("шесть файлов: квадрат WebP, без растяжения, ≤ 30 КБ", () => {
    expect(DEMO_DOCTOR_PHOTOS).toHaveLength(6);
    for (const p of DEMO_DOCTOR_PHOTOS) {
      const bytes = readFileSync(join(DEMO_PHOTOS_DIR, p.file));
      const info = inspectImage(bytes);
      expect(info, p.file).toMatchObject({
        ok: true,
        info: { type: "image/webp", width: 480, height: 480 },
      });
      expect(bytes.length).toBeLessThan(30 * 1024);
    }
  });

  it("привязываются только к вымышленным врачам с совпадающим id и именем", async () => {
    const t = await setup();
    // Врача переименовали (например, это уже реальный врач клиники) — не трогаем.
    const d = t.store.clinic
      .listDoctors("2026-01-01")
      .find((x) => x.id === "obraztsova")!;
    t.store.clinic.updateDoctor(
      "obraztsova",
      {
        name: "Другая Фамилия",
        specialtyId: d.specialtyId,
        about: d.about,
        slotMinutes: d.slotMinutes,
        priceRub: null,
      },
      NOW.toISOString(),
    );
    // Уже загруженное фото не заменяется без --force.
    t.store.photos.set(
      "maketov",
      png(400, 400),
      "upload",
      NOW.toISOString(),
      1,
    );
    const results = bindDemoPhotos(t.store, NOW.toISOString());
    expect(
      Object.fromEntries(results.map((r) => [r.doctorId, r.result])),
    ).toEqual({
      testova: "set",
      primerov: "set",
      demonstrova: "set",
      maketov: "kept",
      obraztsova: "skipped_name",
      vymyslov: "set",
    });
    expect(t.store.photos.meta("testova")?.source).toBe("demo_ai");
    expect(t.store.photos.meta("maketov")?.source).toBe("upload");
    expect(t.store.photos.meta("obraztsova")).toBeUndefined();
    // Повторный запуск ничего не меняет.
    expect(
      bindDemoPhotos(t.store, NOW.toISOString()).filter(
        (r) => r.result === "set",
      ),
    ).toHaveLength(0);
    // С --force заменяет и загруженное.
    expect(
      bindDemoPhotos(t.store, NOW.toISOString(), { force: true }).find(
        (r) => r.doctorId === "maketov",
      )?.result,
    ).toBe("set");
  });
});

describe("панель: загрузка, замена, удаление", () => {
  it("администратор загружает, заменяет и удаляет фото; аудит без содержимого", async () => {
    const t = await setup();
    const admin = await t.as("admin");
    const up = await admin(
      "PUT",
      "doctors/testova/photo",
      new Uint8Array(DEMO),
      {
        "content-type": "image/webp",
      },
    );
    expect(up.status).toBe(200);
    const first = (up.json.data as { photoUrl: string }).photoUrl;
    expect(first).toMatch(/^\/api\/miniapp\/photos\/testova\?v=[0-9a-f]{12}$/);
    const list = (await admin("GET", "doctors")).json.data as {
      doctors: {
        id: string;
        photoUrl: string | null;
        photoSource: string | null;
      }[];
    };
    expect(list.doctors.find((d) => d.id === "testova")).toMatchObject({
      photoUrl: first,
      photoSource: "upload",
    });
    // Замена: другой файл — другой адрес (кэш браузера не покажет старое фото).
    const replaced = await admin(
      "PUT",
      "doctors/testova/photo",
      jpeg(600, 600),
      {
        "content-type": "image/jpeg",
      },
    );
    expect((replaced.json.data as { photoUrl: string }).photoUrl).not.toBe(
      first,
    );
    expect(t.store.photos.meta("testova")?.type).toBe("image/jpeg");
    // Удаление.
    expect((await admin("DELETE", "doctors/testova/photo")).status).toBe(200);
    expect(t.store.photos.meta("testova")).toBeUndefined();
    expect((await admin("DELETE", "doctors/testova/photo")).status).toBe(404);
    const audit = t.store.admin.listAudit(10).map((a) => a.action);
    expect(audit).toEqual(
      expect.arrayContaining(["set_photo", "delete_photo"]),
    );
  });

  it("опасные и неверные файлы отклоняются; тип в заголовке не обманывает проверку", async () => {
    const t = await setup();
    const admin = await t.as("admin");
    const svg = text(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(
      (
        await admin("PUT", "doctors/testova/photo", svg, {
          "content-type": "image/svg+xml",
        })
      ).status,
    ).toBe(415);
    // SVG под видом PNG.
    const fake = await admin("PUT", "doctors/testova/photo", svg, {
      "content-type": "image/png",
    });
    expect(fake.status).toBe(415);
    expect(fake.json.error).toMatch(/JPEG, PNG или WebP/);
    expect(
      (
        await admin("PUT", "doctors/testova/photo", text("{}"), {
          "content-type": "application/json",
        })
      ).status,
    ).toBe(415);
    const huge = new Uint8Array(PHOTO_MAX_BYTES + 10);
    huge.set(png(800, 800));
    expect(
      (
        await admin("PUT", "doctors/testova/photo", huge, {
          "content-type": "image/png",
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await admin("PUT", "doctors/nobody/photo", png(400, 400), {
          "content-type": "image/png",
        })
      ).status,
    ).toBe(404);
    expect(t.store.photos.all().size).toBe(0);
  });

  it("права: врач не управляет фото; без входа и с чужого сайта — отказ", async () => {
    const t = await setup();
    const doctor = await t.as("dr-maketov");
    expect(
      (
        await doctor("PUT", "doctors/maketov/photo", png(400, 400), {
          "content-type": "image/png",
        })
      ).status,
    ).toBe(403);
    expect((await doctor("DELETE", "doctors/maketov/photo")).status).toBe(403);
    // Владелец управляет врачами — и фото тоже.
    const owner = await t.as("owner");
    expect(
      (
        await owner("PUT", "doctors/maketov/photo", png(400, 400), {
          "content-type": "image/png",
        })
      ).status,
    ).toBe(200);
    // Без сессии.
    const anon = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/doctors/maketov/photo`, {
        method: "DELETE",
        headers: { host: HOST, origin: ORIGIN },
      }),
      ["doctors", "maketov", "photo"],
      t.deps,
    );
    expect(anon.status).toBe(401);
    // С чужого сайта (CSRF) — даже с действующей cookie.
    const admin = await t.as("admin");
    const foreign = await admin("DELETE", "doctors/maketov/photo", undefined, {
      origin: "https://evil.example",
    });
    expect(foreign.status).toBe(403);
    expect(t.store.photos.meta("maketov")).toBeDefined();
  });

  it("удалённый врач теряет и фото", async () => {
    const t = await setup();
    t.store.photos.set(
      "primerov",
      png(400, 400),
      "upload",
      NOW.toISOString(),
      1,
    );
    const admin = await t.as("admin");
    expect((await admin("DELETE", "doctors/primerov")).status).toBe(200);
    expect(t.store.photos.meta("primerov")).toBeUndefined();
  });
});

describe("отдача фото и Mini App", () => {
  it("публичный адрес: тип из базы, nosniff, кэш по версии, 304, 404", async () => {
    const t = await setup();
    t.store.photos.set(
      "testova",
      new Uint8Array(DEMO),
      "demo_ai",
      NOW.toISOString(),
      null,
    );
    const url = photoUrl(t.store.photos.meta("testova"))!;
    const r = photoResponse(
      new Request(`https://${HOST}${url}`),
      t.store.photos,
      "testova",
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/webp");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(r.headers.get("cache-control")).toMatch(/immutable/);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array(DEMO));
    const stale = photoResponse(
      new Request(`https://${HOST}/api/miniapp/photos/testova?v=000000000000`),
      t.store.photos,
      "testova",
    );
    expect(stale.headers.get("cache-control")).toMatch(/must-revalidate/);
    const again = photoResponse(
      new Request(`https://${HOST}${url}`, {
        headers: { "if-none-match": r.headers.get("etag")! },
      }),
      t.store.photos,
      "testova",
    );
    expect(again.status).toBe(304);
    for (const id of ["nobody", "../bot.sqlite", "x".repeat(60)])
      expect(
        photoResponse(new Request(`https://${HOST}/x`), t.store.photos, id)
          .status,
      ).toBe(404);
  });

  it("Mini App: фото в каталоге, карточке и записях; пометка демо-портрета", async () => {
    const t = await setup();
    bindDemoPhotos(t.store, NOW.toISOString());
    t.store.photos.remove("vymyslov");
    const miniConfig: MiniAppConfig = {
      appId: 1,
      secret: "test-secret-not-real-1",
      allowedUserIds: new Set([1001]),
      maxAgeSeconds: 86400,
    };
    const params: Record<string, string> = {
      vk_app_id: "1",
      vk_user_id: "1001",
      vk_ts: String(Math.floor(NOW.getTime() / 1000)),
    };
    const launch = new URLSearchParams({
      ...params,
      sign: signLaunchParams(params, miniConfig.secret),
    }).toString();
    const deps = {
      service: new MiniAppService(t.store, () => NOW),
      config: miniConfig,
      now: () => NOW,
    };
    const call = async (method: string, route: string, body?: unknown) =>
      (
        await (
          await handleMiniAppApi(
            new Request(`https://${HOST}/api/miniapp/${route}`, {
              method,
              headers: {
                [LAUNCH_HEADER]: launch,
                ...(body ? { "content-type": "application/json" } : {}),
              },
              body: body ? JSON.stringify(body) : undefined,
            }),
            route.split("/"),
            deps,
          )
        ).json()
      ).data;
    const clinic = (await call("GET", "clinic")) as {
      doctors: { id: string; photoUrl: string | null; photoIsDemo: boolean }[];
    };
    const testova = clinic.doctors.find((d) => d.id === "testova")!;
    expect(testova.photoUrl).toMatch(/^\/api\/miniapp\/photos\/testova\?v=/);
    expect(testova.photoIsDemo).toBe(true);
    // Без фото — монограмма (адреса нет).
    expect(clinic.doctors.find((d) => d.id === "vymyslov")).toMatchObject({
      photoUrl: null,
      photoIsDemo: false,
    });
    // Запись работает как раньше; в «Моих записях» — фото врача.
    const booked = (await call("POST", "bookings", {
      doctorId: "testova",
      date: "2026-10-21",
      time: "09:00",
    })) as { id: number; doctorPhotoUrl: string | null };
    expect(booked.doctorPhotoUrl).toBe(testova.photoUrl);
    const mine = (await call("GET", "bookings")) as {
      upcoming: { id: number; doctorPhotoUrl: string | null }[];
    };
    expect(mine.upcoming[0].doctorPhotoUrl).toBe(testova.photoUrl);
    const cancelled = (await call("PATCH", `bookings/${booked.id}`, {
      action: "cancel",
    })) as { status: string };
    expect(cancelled.status).toBe("cancelled");
  });
});

describe("сохранность", () => {
  it("фото переживают перезапуск (новое подключение к той же базе)", async () => {
    const path = tempDb();
    const first = new SqliteStore(path);
    first.photos.set(
      "testova",
      new Uint8Array(DEMO),
      "upload",
      NOW.toISOString(),
      1,
    );
    first.close();
    const second = new SqliteStore(path);
    cleanups.push(() => second.close());
    expect(second.photos.read("testova")?.data).toEqual(new Uint8Array(DEMO));
  });

  it("миграция v7 → v8: записи, врачи и сотрудники сохраняются", async () => {
    const path = tempDb();
    const fresh = new SqliteStore(path);
    fresh.admin.createUser("vps-owner", "x", NOW.toISOString(), "owner");
    fresh.insert({
      peerId: 7,
      doctorId: "maketov",
      date: "2026-10-20",
      time: "09:00",
      createdAt: NOW.toISOString(),
    });
    fresh.close();
    const db = new DatabaseSync(path);
    db.exec("DROP TABLE doctor_photos; PRAGMA user_version = 7;");
    db.close();
    const store = new SqliteStore(path);
    cleanups.push(() => store.close());
    expect(store.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(8);
    expect(store.searchBookings({})).toHaveLength(1);
    expect(store.clinic.load().doctors).toHaveLength(6);
    expect(store.admin.findUser("vps-owner")?.role).toBe("owner");
    expect(store.photos.all().size).toBe(0);
  });
});
