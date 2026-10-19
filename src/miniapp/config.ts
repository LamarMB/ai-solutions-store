/**
 * Настройки VK Mini App из окружения (.env.local процесса Next.js).
 * Секрет — защищённый ключ приложения; в журнал и ответы не попадает.
 */
export type MiniAppConfig = {
  appId: number;
  secret: string;
  /**
   * Кому открыт доступ. Прототип работает только с тестовыми аккаунтами, как и
   * бот: пустой список — доступ закрыт всем.
   */
  allowedUserIds: ReadonlySet<number>;
  /** Сообщество клиники — для ссылки «Написать в сообщения сообщества». */
  groupId?: number;
  /** Срок действия параметров запуска, секунд. */
  maxAgeSeconds: number;
};

export type MiniAppConfigResult =
  { ok: true; config: MiniAppConfig } | { ok: false; errors: string[] };

const ids = (value: string | undefined) =>
  (value ?? "")
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map(Number);

/** Ошибки — по имени переменной, без значений. */
export function miniAppConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): MiniAppConfigResult {
  const errors: string[] = [];
  const appId = Number(env.VK_MINIAPP_ID);
  if (!Number.isSafeInteger(appId) || appId <= 0)
    errors.push("VK_MINIAPP_ID: нужен числовой ID приложения");
  const secret = (env.VK_MINIAPP_SECRET ?? "").trim();
  if (secret.length < 10)
    errors.push("VK_MINIAPP_SECRET: защищённый ключ приложения не задан");
  // Отдельный список для Mini App; если не задан — те же тестовые аккаунты, что у бота.
  const raw = env.MINIAPP_ALLOWED_USER_IDS?.trim()
    ? env.MINIAPP_ALLOWED_USER_IDS
    : env.VK_ALLOWED_USER_IDS;
  const allowed = ids(raw);
  if (allowed.some((id) => !Number.isSafeInteger(id) || id <= 0))
    errors.push(
      "MINIAPP_ALLOWED_USER_IDS: список числовых VK ID через запятую",
    );
  const groupId = Number(env.VK_GROUP_ID);
  const hours = env.MINIAPP_LAUNCH_MAX_AGE_HOURS
    ? Number(env.MINIAPP_LAUNCH_MAX_AGE_HOURS)
    : 24;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168)
    errors.push("MINIAPP_LAUNCH_MAX_AGE_HOURS: число часов от 1 до 168");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      appId,
      secret,
      allowedUserIds: new Set(allowed),
      ...(Number.isSafeInteger(groupId) && groupId > 0 ? { groupId } : {}),
      maxAgeSeconds: Math.round(hours * 3600),
    },
  };
}
