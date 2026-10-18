import type { AdminSession } from "@/bot/storage/admin-store";
import {
  clearSessionCookie,
  cookieName,
  isSameOrigin,
  readCookie,
  SESSION_IDLE_MS,
  sessionCookie,
  type AdminAuth,
  type AuthConfig,
} from "@/admin/auth";
import { LoginSchema, describeZodError } from "@/admin/schemas";
import { AdminError, type AdminService } from "@/admin/service";

export type AdminApiDeps = {
  service: AdminService;
  auth: AdminAuth;
  config: AuthConfig;
  /** Хэш адреса клиента для ограничения попыток входа (src/lib/client-key.ts). */
  clientKey: (request: Request) => string;
  /** Служебный журнал: только метод, путь и статус — без тела запроса. */
  log?: (message: string) => void;
};

const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

const ok = (data: unknown = null, headers?: HeadersInit) =>
  json(200, { ok: true, data }, headers);

const fail = (status: number, error: string, fields?: Record<string, string>) =>
  json(status, { ok: false, error, ...(fields ? { fields } : {}) });

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AdminError(415, "Ожидается JSON.");
  const text = await request.text();
  if (text.length > 64 * 1024)
    throw new AdminError(413, "Слишком большой запрос.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AdminError(400, "Неверный формат данных.");
  }
}

const intId = (value: string | undefined) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0)
    throw new AdminError(404, "Не найдено.");
  return id;
};

/**
 * Единая точка входа API админ-панели: /api/admin/<path>.
 * Без действующей сессии доступен только вход. Любой изменяющий запрос —
 * только со своего сайта (Origin) и только с JSON-телом.
 */
export async function handleAdminApi(
  request: Request,
  path: string[],
  deps: AdminApiDeps,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const route = path.join("/");
  try {
    if (method !== "GET" && !isSameOrigin(request, deps.config))
      return fail(403, "Запрос отклонён: неверный источник.");

    if (route === "login" && method === "POST")
      return await login(request, deps);

    const token = readCookie(
      request.headers.get("cookie"),
      cookieName(deps.config),
    );
    const session = deps.auth.verify(token);
    if (!session) return fail(401, "Требуется вход в панель.");

    if (route === "logout" && method === "POST") {
      deps.auth.logout(token);
      return ok(null, { "Set-Cookie": clearSessionCookie(deps.config) });
    }
    return await dispatch(request, method, path, session, deps.service);
  } catch (error) {
    if (error instanceof AdminError)
      return fail(error.status, error.message, error.fields);
    deps.log?.(
      `admin api ${method} /${route}: ${error instanceof Error ? error.name : "error"}`,
    );
    return fail(500, "Не удалось выполнить действие. Попробуйте ещё раз.");
  }
}

async function login(request: Request, deps: AdminApiDeps): Promise<Response> {
  const parsed = LoginSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    const { message, fields } = describeZodError(parsed.error);
    return fail(400, message, fields);
  }
  const result = await deps.auth.login(
    parsed.data.login,
    parsed.data.password,
    deps.clientKey(request),
  );
  if (!result.ok) {
    return result.reason === "locked"
      ? fail(429, "Слишком много неудачных попыток. Подождите 15 минут.")
      : fail(401, "Неверный логин или пароль.");
  }
  return ok(
    { login: result.session.login },
    {
      "Set-Cookie": sessionCookie(
        deps.config,
        result.token,
        Math.floor(SESSION_IDLE_MS / 1000),
      ),
    },
  );
}

async function dispatch(
  request: Request,
  method: string,
  path: string[],
  session: AdminSession,
  service: AdminService,
): Promise<Response> {
  const [section, id, sub] = path;
  const user = session.userId;
  const query = Object.fromEntries(new URL(request.url).searchParams);

  switch (`${method} ${section}${id ? "/:id" : ""}${sub ? `/${sub}` : ""}`) {
    case "GET me":
      return ok({ login: session.login });
    case "GET dashboard":
      return ok(service.dashboard());

    case "GET bookings":
      return ok(service.listBookings(query));
    case "POST bookings":
      return ok(service.createBooking(await readJson(request), user));
    case "PATCH bookings/:id":
      return ok(
        service.updateBooking(intId(id), await readJson(request), user),
      );

    case "GET slots":
      return ok(
        service.freeSlots(
          String(query.doctorId ?? ""),
          String(query.date ?? ""),
        ),
      );

    case "GET doctors":
      return ok(service.listDoctors());
    case "POST doctors":
      return ok(service.createDoctor(await readJson(request), user));
    case "PATCH doctors/:id":
      return ok(service.updateDoctor(id!, await readJson(request), user));
    case "DELETE doctors/:id":
      return ok(service.deleteDoctor(id!, user));

    case "POST specialties":
      return ok(service.createSpecialty(await readJson(request), user));
    case "PATCH specialties/:id":
      return ok(service.updateSpecialty(id!, await readJson(request), user));

    case "GET schedule/:id":
      return ok(service.getSchedule(id!));
    case "PUT schedule/:id/hours":
      return ok(service.setHours(id!, await readJson(request), user));
    case "GET exceptions":
      return ok(service.listExceptions());
    case "POST exceptions":
      return ok(service.addException(await readJson(request), user));
    case "DELETE exceptions/:id":
      return ok(service.deleteException(intId(id), user));

    case "GET settings":
      return ok(service.getSettings());
    case "PUT settings":
      return ok(service.updateSettings(await readJson(request), user));
  }
  return fail(404, "Не найдено.");
}
