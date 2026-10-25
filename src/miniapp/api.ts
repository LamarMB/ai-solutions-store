import type { MiniAppConfig } from "@/miniapp/config";
import { verifyLaunchParams } from "@/miniapp/launch-params";
import { MiniAppError, type MiniAppService } from "@/miniapp/service";

/** Заголовок, в котором клиент передаёт строку параметров запуска как есть. */
export const LAUNCH_HEADER = "x-vk-launch-params";

export type MiniAppApiDeps = {
  service: MiniAppService;
  config: MiniAppConfig;
  now?: () => Date;
  /** Служебный журнал: метод, маршрут, статус — без параметров запуска и тела. */
  log?: (message: string) => void;
};

const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: NO_STORE });
const ok = (data: unknown) => json(200, { ok: true, data });
const fail = (status: number, code: string, error: string) =>
  json(status, { ok: false, code, error });

/**
 * Ограничение частоты по пациенту (в памяти процесса): чтение — 120 запросов в
 * минуту, изменения — 20. Защищает расписание от перебора и случайных циклов.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}

  allow(key: string, limit: number, windowMs = 60_000): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((at) => t - at < windowMs);
    if (list.length >= limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits)
        if (v.every((at) => t - at >= windowMs)) this.hits.delete(k);
    }
    return true;
  }
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new MiniAppError(415, "content_type", "Ожидается JSON.");
  const text = await request.text();
  if (text.length > 4096)
    throw new MiniAppError(413, "too_large", "Слишком большой запрос.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new MiniAppError(400, "invalid", "Неверный формат данных.");
  }
}

const intId = (value: string | undefined) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new MiniAppError(404, "missing", "Запись не найдена.");
  return id;
};

const limiters = new WeakMap<MiniAppApiDeps, RateLimiter>();

/**
 * API Mini App: /api/miniapp/<path>. Каждый запрос — только с подписанными
 * параметрами запуска VK в заголовке; пациент — vk_user_id из проверенной
 * строки. Cookie не используются (браузер в iframe ВКонтакте может их не
 * хранить), поэтому подделка запроса с чужого сайта невозможна: без подписи
 * доступа нет, а нестандартный заголовок требует разрешения CORS, которого нет.
 */
export async function handleMiniAppApi(
  request: Request,
  path: string[],
  deps: MiniAppApiDeps,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const route = path.join("/");
  const now = deps.now ?? (() => new Date());
  try {
    const check = verifyLaunchParams(request.headers.get(LAUNCH_HEADER), {
      secret: deps.config.secret,
      appId: deps.config.appId,
      now,
      maxAgeSeconds: deps.config.maxAgeSeconds,
    });
    if (!check.ok) {
      deps.log?.(`miniapp ${method} /${route}: 401 ${check.reason}`);
      return check.reason === "expired"
        ? fail(
            401,
            "expired",
            "Сеанс устарел. Закройте и снова откройте приложение во ВКонтакте.",
          )
        : fail(401, "unauthorized", "Откройте приложение во ВКонтакте.");
    }
    const userId = check.params.userId;
    if (!deps.config.allowedUserIds.has(userId))
      return fail(
        403,
        "not_allowed",
        "Демо-версия доступна только тестовым аккаунтам клиники.",
      );

    let limiter = limiters.get(deps);
    if (!limiter) {
      limiter = new RateLimiter(() => now().getTime());
      limiters.set(deps, limiter);
    }
    const mutation = method !== "GET";
    if (
      !limiter.allow(`r:${userId}`, 120) ||
      (mutation && !limiter.allow(`w:${userId}`, 20))
    )
      return fail(
        429,
        "rate_limit",
        "Слишком много запросов. Подождите минуту.",
      );

    return await dispatch(request, method, path, userId, deps);
  } catch (error) {
    if (error instanceof MiniAppError)
      return fail(error.status, error.code, error.message);
    deps.log?.(
      `miniapp ${method} /${route}: ${error instanceof Error ? error.name : "error"}`,
    );
    return fail(
      500,
      "server",
      "Не удалось выполнить действие. Попробуйте ещё раз.",
    );
  }
}

async function dispatch(
  request: Request,
  method: string,
  path: string[],
  userId: number,
  { service, config }: MiniAppApiDeps,
): Promise<Response> {
  const [section, id, sub] = path;
  if (path.length > 3) return fail(404, "not_found", "Не найдено.");
  const query = new URL(request.url).searchParams;
  const key = `${method} ${section ?? ""}${id ? "/:id" : ""}${sub ? `/${sub}` : ""}`;

  switch (key) {
    case "GET clinic":
      return ok(service.clinicInfo(config.groupId));
    case "GET doctors/:id/days":
      return ok(service.days(id!));
    case "GET doctors/:id/slots":
      return ok(service.slots(id!, query.get("date") ?? ""));
    case "GET bookings":
      return ok(service.myBookings(userId));
    case "POST bookings":
      return ok(service.book(userId, await readJson(request)));
    case "PATCH bookings/:id":
      return ok(service.update(userId, intId(id), await readJson(request)));
  }
  return fail(404, "not_found", "Не найдено.");
}
