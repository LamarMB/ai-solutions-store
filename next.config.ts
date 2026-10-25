import type { NextConfig } from "next";
import { getSeoConfig } from "./src/lib/seo-config";

/**
 * Заголовки безопасности для всех ответов. CSP ограничивает только встраивание,
 * базовый адрес, отправку форм и плагины: строгая политика для скриптов требует
 * nonce и динамического рендеринга всех страниц (см. docs/production-readiness.md).
 * HSTS выставляет reverse proxy на https (docs/deployment-plan.md).
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

/** Встраивание запрещено везде, кроме страницы VK Mini App. */
const NO_FRAMING = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value:
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

/**
 * VK Mini App открывается во фрейме веб-версии ВКонтакте (vk.com, m.vk.com,
 * vk.ru); мобильные клиенты — во встроенном браузере. Разрешаются только эти
 * источники. X-Frame-Options не задаётся: он не умеет списка доменов.
 */
export const MINIAPP_FRAME_ANCESTORS =
  "https://vk.com https://*.vk.com https://vk.ru https://*.vk.ru";
const MINIAPP_FRAMING = [
  {
    key: "Content-Security-Policy",
    value: `frame-ancestors ${MINIAPP_FRAME_ANCESTORS}; base-uri 'self'; form-action 'self'; object-src 'none'`,
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Настройки индексации фиксируются при сборке (см. docs/seo.md).
  env: {
    SITE_URL: process.env.SITE_URL ?? "",
    SITE_INDEXING: process.env.SITE_INDEXING ?? "",
  },
  // Не раскрываем стек в заголовке X-Powered-By.
  poweredByHeader: false,
  // Раздел «Отрасли» убран: сайт посвящён медицинским клиникам.
  async redirects() {
    return [
      { source: "/industries", destination: "/catalog", permanent: false },
    ];
  },
  async headers() {
    const headers = [...SECURITY_HEADERS];
    // Пока индексация не включена, запрет дублируется заголовком для всех ответов,
    // включая файлы и sitemap, где нет meta-тега robots.
    if (!getSeoConfig().indexing) {
      headers.push({ key: "X-Robots-Tag", value: "noindex, nofollow" });
    }
    return [
      { source: "/:path*", headers },
      // Всё, кроме /miniapp и /miniapp/…, нельзя встраивать во фреймы.
      { source: "/:path((?!miniapp(?:/|$)).*)", headers: NO_FRAMING },
      { source: "/miniapp", headers: MINIAPP_FRAMING },
      { source: "/miniapp/:path*", headers: MINIAPP_FRAMING },
    ];
  },
};

export default nextConfig;
