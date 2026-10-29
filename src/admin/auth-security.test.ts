import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAdminApi, type AdminApiDeps } from "@/admin/api";
import {
  AdminAuth,
  FAILURE_WINDOW_MS,
  LOGIN_LIMITS,
  type AuthConfig,
} from "@/admin/auth";
import * as passwords from "@/admin/password";
import { AdminService } from "@/admin/service";
import { INVITE_MAX_FAILURES } from "@/admin/staff";
import { SqliteStore } from "@/bot/storage/sqlite";
import { createClientKeyHasher } from "@/lib/client-key";

/**
 * Безопасность входа в панель и приглашений (P0-13): подбор пароля и токена,
 * блокировка и её окончание, одинаковые ответы для существующих и
 * несуществующих логинов, попытки обхода. Учётные записи — тестовые.
 */

vi.mock("@/admin/password", async (original) => {
  const actual = await original<typeof import("@/admin/password")>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) };
});

const NOW = new Date("2026-10-19T06:00:00Z");
const HOST = "clinic.example";
const ORIGIN = `https://${HOST}`;
const PASSWORD = "надёжный-пароль-2026";
const NEW_PASSWORD = "зелёный-чайник-47";
const config: AuthConfig = { secureCookie: true, allowedOrigins: [] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  while (cleanups.length) cleanups.pop()!();
});

/** Случайный токен правильного формата (43 знака base64url). */
const fakeToken = (i: number) =>
  `${"A".repeat(40)}${String(i).padStart(3, "0")}`;

async function setup({ realClientKey = false } = {}) {
  let now = NOW;
  const clock = () => now;
  const store = new SqliteStore(":memory:");
  cleanups.push(() => store.close());
  const hash = await passwords.hashPassword(PASSWORD);
  store.admin.createUser("owner", hash, NOW.toISOString(), "owner");
  store.admin.createUser("off", hash, NOW.toISOString(), "admin");
  store.admin.setDisabled("off", true, NOW.toISOString());
  const logs: string[] = [];
  const hasher = createClientKeyHasher();
  const deps: AdminApiDeps = {
    service: new AdminService(store, clock),
    auth: new AdminAuth(store.admin, clock),
    config,
    // Адрес клиента: в тестах — заголовок x-test-ip, или настоящий хэш X-Forwarded-For.
    clientKey: (request) =>
      realClientKey
        ? hasher(request.headers)
        : (request.headers.get("x-test-ip") ?? "ip-1"),
    log: (m) => logs.push(m),
  };
  const call = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/${path}`, {
        method: "POST",
        headers: {
          host: HOST,
          origin: ORIGIN,
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      }),
      path.split("/"),
      deps,
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        ok: boolean;
        error?: string;
        data?: unknown;
      },
      cookie: response.headers.get("set-cookie"),
    };
  };
  const login = (l: string, password: string, ip = "ip-1", extra = {}) =>
    call("login", { login: l, password }, { "x-test-ip": ip, ...extra });
  const invite = async () => {
    const owner = await login("owner", PASSWORD, "owner-ip");
    const cookie = owner.cookie!.split(";")[0];
    const r = await call(
      "invites",
      { login: "new.admin", role: "admin" },
      { cookie },
    );
    return (r.body.data as { token: string }).token;
  };
  return {
    store,
    deps,
    logs,
    call,
    login,
    invite,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const LOCKED = "Слишком много неудачных попыток. Подождите 15 минут.";
const INVALID = "Неверный логин или пароль.";

describe("вход: подбор пароля", () => {
  it("5 неверных паролей с одного адреса — блокировка этого адреса для логина, даже с верным паролем", async () => {
    const t = await setup();
    for (let i = 0; i < LOGIN_LIMITS.pair; i++)
      expect((await t.login("owner", `неверный-${i}-пароль1`)).status).toBe(
        401,
      );
    const locked = await t.login("owner", PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe(LOCKED);
    expect(locked.cookie).toBeNull();
    // Владелец с другого адреса входит: чужие пять ошибок его не блокируют.
    expect((await t.login("owner", PASSWORD, "ip-2")).status).toBe(200);
  });

  it("после окончания блокировки вход снова работает", async () => {
    const t = await setup();
    for (let i = 0; i < LOGIN_LIMITS.pair; i++)
      await t.login("owner", `неверный-${i}-пароль1`);
    expect((await t.login("owner", PASSWORD)).status).toBe(429);
    t.advance(FAILURE_WINDOW_MS - 60_000);
    expect((await t.login("owner", PASSWORD)).status).toBe(429);
    t.advance(60_001);
    const ok = await t.login("owner", PASSWORD);
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^__Host-admin_session=/);
  });

  it("распределённый подбор: 20 ошибок с разных адресов закрывают логин на 15 минут", async () => {
    const t = await setup();
    for (let i = 0; i < LOGIN_LIMITS.login; i++)
      await t.login("owner", `неверный-${i}-пароль1`, `bot-${i}`);
    expect((await t.login("owner", PASSWORD, "new-ip")).status).toBe(429);
    // Другие логины не затронуты.
    expect((await t.login("off", PASSWORD, "new-ip")).status).toBe(401);
    t.advance(FAILURE_WINDOW_MS + 1);
    expect((await t.login("owner", PASSWORD, "new-ip")).status).toBe(200);
  });

  it("перебор логинов с одного адреса: после 10 ошибок адрес закрыт для любого логина", async () => {
    const t = await setup();
    for (let i = 0; i < LOGIN_LIMITS.ip; i++)
      await t.login(`user${i}`, `неверный-${i}-пароль1`);
    expect((await t.login("owner", PASSWORD)).status).toBe(429);
    expect((await t.login("owner", PASSWORD, "ip-2")).status).toBe(200);
  });

  it("существование логина не раскрывается: одинаковые ответы и одинаковая блокировка", async () => {
    const t = await setup();
    const existing = await t.login("owner", "неверный-пароль-1");
    const unknown = await t.login("nobody", "неверный-пароль-1", "ip-2");
    const disabled = await t.login("off", PASSWORD, "ip-3");
    for (const r of [existing, unknown, disabled]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ ok: false, error: INVALID });
    }
    // Несуществующий логин блокируется так же, как существующий.
    for (let i = 0; i < LOGIN_LIMITS.pair; i++) {
      await t.login("owner", `неверный-${i}-пароль1`, "ip-4");
      await t.login("nobody", `неверный-${i}-пароль1`, "ip-5");
    }
    const a = await t.login("owner", "неверный-пароль-1", "ip-4");
    const b = await t.login("nobody", "неверный-пароль-1", "ip-5");
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(a.body).toEqual(b.body);
  });

  it("обход не работает: регистр и пробелы в логине, новая или чужая cookie", async () => {
    const t = await setup();
    const variants = ["owner", "OWNER", " Owner ", "oWnEr", "owner"];
    for (const [i, l] of variants.entries())
      await t.login(l, `неверный-${i}-пароль1`, "ip-1", {
        // Каждый раз «новая сессия»: случайная cookie или её нет.
        ...(i % 2 ? { cookie: `__Host-admin_session=fake${i}` } : {}),
      });
    expect((await t.login("owner", PASSWORD)).status).toBe(429);
    expect(
      (
        await t.login("Owner", PASSWORD, "ip-1", {
          cookie: "__Host-admin_session=other",
        })
      ).status,
    ).toBe(429);
  });

  it("подмена X-Forwarded-For не сбрасывает счётчик: учитывается адрес от прокси", async () => {
    const t = await setup({ realClientKey: true });
    for (let i = 0; i < LOGIN_LIMITS.pair; i++)
      await t.login("owner", `неверный-${i}-пароль1`, "", {
        "x-forwarded-for": `10.0.0.${i}, 203.0.113.7`,
      });
    const r = await t.login("owner", PASSWORD, "", {
      "x-forwarded-for": "198.51.100.1, 203.0.113.7",
    });
    expect(r.status).toBe(429);
    const other = await t.login("owner", PASSWORD, "", {
      "x-forwarded-for": "203.0.113.8",
    });
    expect(other.status).toBe(200);
  });

  it("обычный вход работает, неудачные попытки до входа не мешают", async () => {
    const t = await setup();
    for (let i = 0; i < LOGIN_LIMITS.pair - 1; i++)
      await t.login("owner", `неверный-${i}-пароль1`);
    const ok = await t.login("owner", PASSWORD);
    expect(ok.status).toBe(200);
    // Успешный вход сбросил счётчик адреса и логина.
    for (let i = 0; i < LOGIN_LIMITS.pair - 1; i++)
      await t.login("owner", `неверный-${i}-пароль1`);
    expect((await t.login("owner", PASSWORD)).status).toBe(200);
  });
});

describe("приглашения: перебор токенов", () => {
  it("выдуманные токены: без scrypt, после 10 — 429 даже для настоящего токена; другой адрес и окончание блокировки", async () => {
    const t = await setup();
    const token = await t.invite();
    vi.mocked(passwords.hashPassword).mockClear();
    const findInvite = vi.spyOn(t.store.admin, "findInvite");

    for (let i = 0; i < INVITE_MAX_FAILURES; i++) {
      const path = i % 2 ? "invite/info" : "invite/accept";
      const r = await t.call(
        path,
        {
          token: i % 3 ? fakeToken(i) : `bad token ${i} !!!!!!!!!!!!`,
          password: NEW_PASSWORD,
        },
        { "x-test-ip": "attacker" },
      );
      expect(r.status).toBe(404);
      expect(r.body.error).toMatch(/^Приглашение недействительно/);
    }
    // Ни одного вычисления scrypt; неверный формат — даже без запроса к базе.
    expect(passwords.hashPassword).not.toHaveBeenCalled();
    expect(findInvite).toHaveBeenCalledTimes(
      Array.from({ length: INVITE_MAX_FAILURES }, (_, i) => i % 3).filter(
        Boolean,
      ).length,
    );

    const blocked = await t.call(
      "invite/accept",
      { token, password: NEW_PASSWORD },
      { "x-test-ip": "attacker" },
    );
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe(
      "Слишком много попыток. Подождите 15 минут.",
    );
    expect(passwords.hashPassword).not.toHaveBeenCalled();

    // Настоящий сотрудник с другого адреса принимает приглашение.
    const info = await t.call(
      "invite/info",
      { token },
      { "x-test-ip": "staff" },
    );
    expect(info.body.data).toEqual({ login: "new.admin", role: "admin" });

    // У атакующего блокировка заканчивается через 15 минут.
    t.advance(FAILURE_WINDOW_MS + 1);
    expect(
      (await t.call("invite/info", { token }, { "x-test-ip": "attacker" }))
        .status,
    ).toBe(200);
  });

  it("принятие приглашения: проверка пароля после токена, логин в пароле запрещён, повтор — 404", async () => {
    const t = await setup();
    const token = await t.invite();
    vi.mocked(passwords.hashPassword).mockClear();
    const weak = await t.call("invite/accept", {
      token,
      password: "new.admin-2026-x",
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toBe("Пароль не должен содержать логин.");
    const common = await t.call("invite/accept", {
      token,
      password: "Admin2026!!",
    });
    expect(common.status).toBe(400);
    expect(passwords.hashPassword).not.toHaveBeenCalled();

    const ok = await t.call("invite/accept", { token, password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(passwords.hashPassword).toHaveBeenCalledTimes(1);
    expect((await t.login("new.admin", NEW_PASSWORD, "ip-9")).status).toBe(200);
    const again = await t.call("invite/accept", {
      token,
      password: NEW_PASSWORD,
    });
    expect(again.status).toBe(404);
  });

  it("пароли и токены не попадают в журналы и журнал действий", async () => {
    const t = await setup();
    const token = await t.invite();
    await t.login("owner", "секретный-неверный-1");
    await t.call("invite/accept", { token, password: NEW_PASSWORD });
    await t.call("invite/accept", {
      token: fakeToken(1),
      password: NEW_PASSWORD,
    });
    const audit = JSON.stringify(t.store.admin.listAudit(500));
    for (const secret of [
      token,
      NEW_PASSWORD,
      PASSWORD,
      "секретный-неверный-1",
    ]) {
      expect(t.logs.join("\n")).not.toContain(secret);
      expect(audit).not.toContain(secret);
    }
  });
});

describe("требования к паролю", () => {
  it.each([
    ["Admin2026!!", /слишком простой/],
    ["qwerty12345", /слишком простой/],
    ["1q2w3e4r5t6y", /слишком простой/],
    ["Пароль12345", /слишком простой/],
    ["demomed2026", /слишком простой/],
    ["aaaaa11111", /мало разных символов/],
    ["owner-2026-zx", /не должен содержать логин/],
    ["короткий1", /не короче 10/],
    ["безцифрпароль", /буквы и цифры/],
  ])("«%s» отклоняется", (password, message) => {
    expect(passwords.passwordProblem(password, "owner")).toMatch(message);
  });

  it.each([PASSWORD, NEW_PASSWORD, "Синий кит плывёт 2031"])(
    "«%s» допускается",
    (password) => {
      expect(passwords.passwordProblem(password, "owner")).toBeUndefined();
    },
  );
});
