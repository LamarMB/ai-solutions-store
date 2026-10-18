import { createHash, randomBytes } from "node:crypto";
import type { AdminSession, AdminStore } from "@/bot/storage/admin-store";
import { hashPassword, verifyPassword } from "@/admin/password";

/** Сессия продлевается при активности; без активности истекает через 8 часов. */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
/** И в любом случае — не дольше 7 дней от входа. */
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Неудачные входы: 5 за 15 минут — пауза 15 минут по адресу и по логину. */
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export type AuthConfig = {
  /** Cookie только по https. Отключать — только для локальной разработки. */
  secureCookie: boolean;
  /** Разрешённые источники запросов (Origin), кроме собственного хоста. */
  allowedOrigins: string[];
};

export function authConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  return {
    secureCookie: env.ADMIN_COOKIE_SECURE !== "false",
    allowedOrigins: (env.ADMIN_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean),
  };
}

/** С префиксом __Host- браузер принимает cookie только по https, без Domain и с Path=/. */
export const cookieName = (config: AuthConfig) =>
  config.secureCookie ? "__Host-admin_session" : "admin_session";

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function sessionCookie(
  config: AuthConfig,
  token: string,
  maxAgeSeconds: number,
): string {
  return [
    `${cookieName(config)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    ...(config.secureCookie ? ["Secure"] : []),
  ].join("; ");
}

export const clearSessionCookie = (config: AuthConfig) =>
  sessionCookie(config, "", 0);

/** Значение cookie из заголовка Cookie. */
export function readCookie(
  header: string | null,
  name: string,
): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || undefined;
  }
  return undefined;
}

/**
 * Защита от подделки запросов (CSRF): изменяющий запрос должен прийти со
 * своего сайта. Плюс к SameSite=Strict и обязательному JSON-телу.
 */
export function isSameOrigin(request: Request, config: AuthConfig): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
  ].filter(Boolean);
  if (hosts.includes(originHost)) return true;
  return config.allowedOrigins.includes(origin.replace(/\/$/, ""));
}

/** Ограничение подбора пароля. Хранится в памяти процесса панели. */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  private recent(key: string): number[] {
    const t = this.now();
    const list = (this.failures.get(key) ?? []).filter(
      (at) => t - at < FAILURE_WINDOW_MS,
    );
    if (list.length > 0) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  isLocked(keys: string[]): boolean {
    return keys.some((key) => this.recent(key).length >= MAX_FAILURES);
  }

  fail(keys: string[]) {
    for (const key of keys) {
      const list = this.recent(key);
      list.push(this.now());
      this.failures.set(key, list);
    }
  }

  reset(keys: string[]) {
    for (const key of keys) this.failures.delete(key);
  }
}

/** Хэш-заглушка: при неизвестном логине проверка занимает столько же времени. */
let dummyHash: Promise<string> | undefined;

export type LoginResult =
  | { ok: true; token: string; session: AdminSession }
  | { ok: false; reason: "invalid" | "locked" };

export class AdminAuth {
  constructor(
    private readonly store: AdminStore,
    private readonly now: () => Date = () => new Date(),
    private readonly throttle = new LoginThrottle(() => now().getTime()),
  ) {}

  async login(
    login: string,
    password: string,
    clientKey: string,
  ): Promise<LoginResult> {
    const keys = [`ip:${clientKey}`, `login:${login.toLowerCase()}`];
    if (this.throttle.isLocked(keys)) return { ok: false, reason: "locked" };
    const user = this.store.findUser(login);
    dummyHash ??= hashPassword("dummy-password-for-timing-1");
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await dummyHash),
    );
    if (!user || user.disabled || !valid) {
      this.throttle.fail(keys);
      return { ok: false, reason: "invalid" };
    }
    this.throttle.reset(keys);
    const token = randomBytes(32).toString("base64url");
    const at = this.now();
    this.store.pruneSessions(at.toISOString());
    this.store.createSession(
      hashToken(token),
      user.id,
      at.toISOString(),
      new Date(at.getTime() + SESSION_IDLE_MS).toISOString(),
    );
    this.store.audit(user.id, "login", "admin", user.id, at.toISOString());
    return {
      ok: true,
      token,
      session: this.store.findSession(hashToken(token), at.toISOString())!,
    };
  }

  /** Действующая сессия по токену; продлевает её не чаще раза в 5 минут. */
  verify(token: string | undefined): AdminSession | undefined {
    if (!token || token.length > 200) return undefined;
    const at = this.now();
    const hash = hashToken(token);
    const session = this.store.findSession(hash, at.toISOString());
    if (!session) return undefined;
    if (at.getTime() - Date.parse(session.createdAt) > SESSION_MAX_MS) {
      this.store.deleteSession(hash);
      return undefined;
    }
    if (at.getTime() - Date.parse(session.lastSeenAt) > TOUCH_INTERVAL_MS) {
      this.store.touchSession(
        hash,
        at.toISOString(),
        new Date(at.getTime() + SESSION_IDLE_MS).toISOString(),
      );
    }
    return session;
  }

  logout(token: string | undefined) {
    if (token) this.store.deleteSession(hashToken(token));
  }
}
