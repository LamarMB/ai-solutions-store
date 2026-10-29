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
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from "@/bot/storage/image";
import { LoginSchema, describeZodError } from "@/admin/schemas";
import { PRICE_CSV_MAX_BYTES } from "@/admin/price-import";
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

/**
 * Тело с изображением: только заявленный тип JPEG, PNG или WebP и не больше
 * PHOTO_MAX_BYTES (читается с ограничением, без доверия Content-Length).
 * Содержимое дополнительно проверяет PhotoStore по сигнатуре.
 */
async function readImage(request: Request): Promise<Uint8Array> {
  const type = request.headers.get("content-type")?.split(";")[0].trim();
  if (!type || !(PHOTO_TYPES as readonly string[]).includes(type))
    throw new AdminError(415, "Нужна фотография JPEG, PNG или WebP.");
  return readBytes(request, PHOTO_MAX_BYTES, "не больше 2 МБ");
}

/** Файл прайса CSV (src/admin/price-import.ts): кодировку проверяет разбор. */
async function readCsv(request: Request): Promise<Uint8Array> {
  const type = request.headers.get("content-type")?.split(";")[0].trim();
  if (type !== "text/csv") throw new AdminError(415, "Нужен файл CSV.");
  return readBytes(request, PRICE_CSV_MAX_BYTES, "не больше 1 МБ");
}

/** Тело запроса с ограничением размера, без доверия Content-Length. */
async function readBytes(
  request: Request,
  max: number,
  limit: string,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max)
    throw new AdminError(413, `Файл слишком большой: ${limit}.`);
  const reader = request.body?.getReader();
  if (!reader) throw new AdminError(400, "Пустой файл.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AdminError(413, `Файл слишком большой: ${limit}.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

/** Настройки клиники вместе со справочником услуг (до SERVICES_MAX) — больше. */
const SETTINGS_JSON_MAX = 512 * 1024;

async function readJson(request: Request, max = 64 * 1024): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AdminError(415, "Ожидается JSON.");
  const text = await request.text();
  if (text.length > max) throw new AdminError(413, "Слишком большой запрос.");
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
      return ok(
        deps.service.staff.inviteInfo(
          String(body.token ?? ""),
          deps.clientKey(request),
        ),
      );
    }
    if (route === "invite/accept" && method === "POST")
      return ok(
        await deps.service.staff.acceptInvite(
          await readJson(request),
          deps.clientKey(request),
        ),
      );

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
  "PUT doctors/:id/photo": "doctors.write",
  "DELETE doctors/:id/photo": "doctors.write",
  "POST specialties": "doctors.write",
  "PATCH specialties/:id": "doctors.write",
  "GET schedule/:id": "schedule.read",
  "PUT schedule/:id/hours": "schedule.write",
  "GET exceptions": "schedule.read",
  "POST exceptions": "schedule.write",
  "DELETE exceptions/:id": "schedule.write",
  "GET settings": "settings.read",
  "PUT settings": "settings.write",
  "GET price-template": "settings.read",
  "POST price-import": "settings.write",
  "PUT price-import": "settings.write",
  "GET staff": "staff.manage",
  "PATCH staff/:id": "staff.manage",
  "POST invites": "staff.manage",
  "DELETE invites/:id": "staff.manage",
  "GET medical-log": "medical_log.read",
  "GET requests": "requests.handle",
  "GET requests/:id/content": "requests.handle",
  "PATCH requests/:id": "requests.handle",
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
    case "PUT doctors/:id/photo":
      return ok(service.setDoctorPhoto(id!, await readImage(request), user));
    case "DELETE doctors/:id/photo":
      return ok(service.deleteDoctorPhoto(id!, user));

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
      return ok(
        service.updateSettings(
          await readJson(request, SETTINGS_JSON_MAX),
          user,
        ),
      );

    case "GET price-template":
      return new Response(service.priceTemplate(), {
        headers: {
          ...NO_STORE,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="price.csv"',
        },
      });
    // Предпросмотр импорта (без изменений) и применение показанного плана.
    case "POST price-import":
      return ok(service.previewPriceImport(await readCsv(request)));
    case "PUT price-import":
      return ok(
        service.applyPriceImport(
          await readCsv(request),
          String(query.token ?? ""),
          user,
        ),
      );

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
    case "GET requests":
      return ok(service.listRequests());
    case "GET requests/:id/content":
      return ok(service.readRequest(session, intId(id)));
    case "PATCH requests/:id":
      return ok(
        service.updateRequest(session, intId(id), await readJson(request)),
      );
    case "GET my/bookings":
      return ok(service.myBookings(session, query));
    case "GET my/:id/medical":
      return ok(service.readMedical(session, intId(id)));
  }
  return fail(404, "Не найдено.");
}
