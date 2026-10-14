// Без импортов через алиас: модуль используется и в next.config.ts.

/**
 * Настройки индексации. Читаются при сборке (`next build`) из переменных окружения:
 * - `SITE_URL` — постоянный адрес сайта (https://…), без него canonical, sitemap и
 *   Open Graph строятся от локального адреса;
 * - `SITE_INDEXING=true` — разрешить индексацию. Действует только вместе с
 *   корректным `SITE_URL` на https.
 * По умолчанию индексация запрещена: preview и демо-версия не попадают в поиск.
 */
export type SeoConfig = {
  /** База для абсолютных адресов. */
  baseUrl: URL;
  /** Адрес задан явно (а не локальный по умолчанию). */
  hasSiteUrl: boolean;
  /** Индексация разрешена. */
  indexing: boolean;
};

const FALLBACK_URL = "http://localhost:3000";

type Env = {
  SITE_URL?: string;
  SITE_INDEXING?: string;
  [key: string]: string | undefined;
};

function parseSiteUrl(raw: string | undefined): URL | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Только origin: путь, параметры и хэш в базовом адресе не нужны.
    return new URL(url.origin);
  } catch {
    return null;
  }
}

/**
 * Значения по умолчанию читаются явными обращениями `process.env.X`: next.config.ts
 * передаёт их через `env`, и сборщик подставляет их в код при сборке. Поэтому
 * статические и динамические страницы ведут себя одинаково, даже если сервер
 * запущен без этих переменных.
 */
export function getSeoConfig(
  env: Env = {
    SITE_URL: process.env.SITE_URL,
    SITE_INDEXING: process.env.SITE_INDEXING,
  },
): SeoConfig {
  const siteUrl = parseSiteUrl(env.SITE_URL);
  return {
    baseUrl: siteUrl ?? new URL(FALLBACK_URL),
    hasSiteUrl: siteUrl !== null,
    indexing:
      env.SITE_INDEXING?.trim() === "true" && siteUrl?.protocol === "https:",
  };
}
