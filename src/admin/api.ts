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
import { can, type Permission } from "@/admin/permissions";
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
    // Приглашение сотрудника: без сессии, по одноразовому токену.
    if (route === "invite/info" && method === "POST") {
      const body = (await readJson(request)) as { token?: unknown };
      return ok(deps.service.staff.inviteInfo(String(body.token ?? "")));
    }
    if (route === "invite/accept" && method === "POST")
      return ok(await deps.service.staff.acceptInvite(await readJson(request)));

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
    { login: result.session.login, role: result.session.role },
    {
      "Set-Cookie": sessionCookie(
        deps.config,
        result.token,
        Math.floor(SESSION_IDLE_MS / 1000),
      ),
    },
  );
}

/**
 * Маршрут → право. Маршрута нет в таблице — 404; права нет — 403. Проверка
 * для каждого запроса, независимо от того, что показывает интерфейс.
 */
const ROUTES: Record<string, Permission | null> = {
  "GET me": null,
  "GET dashboard": "dashboard.read",
  "GET bookings": "bookings.read",
  "POST bookings": "bookings.write",
  "PATCH bookings/:id": "bookings.write",
  "GET slots": "bookings.read",
  "GET doctors": "doctors.read",
  "POST doctors": "doctors.write",
  "PATCH doctors/:id": "doctors.write",
  "DELETE doctors/:id": "doctors.write",
  "POST specialties": "doctors.write",
  "PATCH specialties/:id": "doctors.write",
  "GET schedule/:id": "schedule.read",
  "PUT schedule/:id/hours": "schedule.write",
  "GET exceptions": "schedule.read",
  "POST exceptions": "schedule.write",
  "DELETE exceptions/:id": "schedule.write",
  "GET settings": "settings.read",
  "PUT settings": "settings.write",
  "GET staff": "staff.manage",
  "PATCH staff/:id": "staff.manage",
  "POST invites": "staff.manage",
  "DELETE invites/:id": "staff.manage",
  "GET medical-log": "medical_log.read",
  "GET my/bookings": "own_bookings.read",
  "GET my/:id/medical": "own_medical.request",
};

async function dispatch(
  request: Request,
  method: string,
  path: string[],
  session: AdminSession,
  service: AdminService,
): Promise<Response> {
  const [section, id, sub] = path;
  if (path.length > 3) return fail(404, "Не найдено.");
  const user = session.userId;
  const query = Object.fromEntries(new URL(request.url).searchParams);
  // «my/bookings» — отдельный раздел; «my/<номер>/medical» — сведения записи.
  const key =
    section === "my" && id === "bookings" && !sub
      ? `${method} my/bookings`
      : `${method} ${section}${id ? "/:id" : ""}${sub ? `/${sub}` : ""}`;

  if (!(key in ROUTES)) return fail(404, "Не найдено.");
  const permission = ROUTES[key];
  if (permission && !can(session.role, permission))
    return fail(403, "Недостаточно прав для этого раздела.");

  switch (key) {
    case "GET me":
      return ok({
        login: session.login,
        role: session.role,
        doctorId: session.doctorId,
      });
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

    case "GET staff":
      return ok(service.staff.list());
    case "PATCH staff/:id":
      return ok(
        service.staff.update(intId(id), await readJson(request), session),
      );
    case "POST invites":
      return ok(service.staff.createInvite(await readJson(request), session));
    case "DELETE invites/:id":
      return ok(service.staff.revokeInvite(intId(id), session));

    case "GET medical-log":
      return ok(service.medicalAccessLog());
    case "GET my/bookings":
      return ok(service.myBookings(session, query));
    case "GET my/:id/medical":
      return ok(service.readMedical(session, intId(id)));
  }
  return fail(404, "Не найдено.");
}
