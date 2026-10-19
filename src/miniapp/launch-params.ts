import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Проверка подписи параметров запуска VK Mini Apps.
 *
 * ВКонтакте открывает приложение по адресу с параметрами `vk_*` и подписью
 * `sign`: HMAC-SHA256 от строки `vk_`-параметров, отсортированных по имени
 * (`ключ=encodeURIComponent(значение)` через `&`), с защищённым ключом
 * приложения; результат — base64 с заменой `+`→`-`, `/`→`_` и без `=`.
 * Алгоритм и тестовый пример — официальный пример VKCOM/vk-apps-launch-params
 * (examples/node.js). VK ID берётся только из проверенной строки, никогда — из
 * тела запроса или отдельного поля.
 */
export type LaunchParams = {
  userId: number;
  appId: number;
  /** Сообщество, из которого открыто приложение (если есть). */
  groupId?: number;
  platform: string;
  /** Время запуска (секунды), если ВКонтакте его передал. */
  ts?: number;
};

export type LaunchCheck =
  | { ok: true; params: LaunchParams }
  | {
      ok: false;
      reason: "missing" | "bad_sign" | "wrong_app" | "expired" | "invalid";
    };

export type LaunchCheckOptions = {
  secret: string;
  appId: number;
  now?: () => Date;
  /** Сколько секунд после запуска принимаются параметры (если есть vk_ts). */
  maxAgeSeconds?: number;
};

/** Ограничение длины: подпись проверяется только у разумной строки. */
const MAX_QUERY_LENGTH = 4096;

export function signLaunchParams(
  params: Record<string, string>,
  secret: string,
): string {
  const query = Object.keys(params)
    .filter((key) => key.startsWith("vk_"))
    // Порядок по кодам символов (как ksort): имена — латиница и «_».
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${key}=${encodeURIComponent(params[key])}`)
    .join("&");
  return createHmac("sha256", secret)
    .update(query)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function verifyLaunchParams(
  query: string | null | undefined,
  { secret, appId, now = () => new Date(), maxAgeSeconds }: LaunchCheckOptions,
): LaunchCheck {
  if (!query || query.length > MAX_QUERY_LENGTH)
    return { ok: false, reason: "missing" };
  const search = new URLSearchParams(
    query.startsWith("?") ? query.slice(1) : query,
  );
  const sign = search.get("sign");
  const params: Record<string, string> = {};
  for (const [key, value] of search) {
    if (!key.startsWith("vk_")) continue;
    // Повтор параметра — признак подмены строки: такие запросы отклоняются.
    if (key in params) return { ok: false, reason: "invalid" };
    params[key] = value;
  }
  if (!sign || Object.keys(params).length === 0)
    return { ok: false, reason: "missing" };

  const expected = Buffer.from(signLaunchParams(params, secret));
  const actual = Buffer.from(sign);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return { ok: false, reason: "bad_sign" };

  const userId = Number(params.vk_user_id);
  const app = Number(params.vk_app_id);
  if (!Number.isSafeInteger(userId) || userId <= 0)
    return { ok: false, reason: "invalid" };
  if (app !== appId) return { ok: false, reason: "wrong_app" };

  const ts = params.vk_ts !== undefined ? Number(params.vk_ts) : undefined;
  if (ts !== undefined && maxAgeSeconds !== undefined) {
    const age = now().getTime() / 1000 - ts;
    // Небольшой допуск на расхождение часов.
    if (!Number.isFinite(age) || age > maxAgeSeconds || age < -300)
      return { ok: false, reason: "expired" };
  }
  const groupId = params.vk_group_id ? Number(params.vk_group_id) : undefined;
  return {
    ok: true,
    params: {
      userId,
      appId: app,
      ...(groupId && Number.isSafeInteger(groupId) ? { groupId } : {}),
      platform: params.vk_platform ?? "",
      ...(ts !== undefined && Number.isFinite(ts) ? { ts } : {}),
    },
  };
}
