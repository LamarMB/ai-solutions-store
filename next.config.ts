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
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value:
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
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
  async headers() {
    const headers = [...SECURITY_HEADERS];
    // Пока индексация не включена, запрет дублируется заголовком для всех ответов,
    // включая файлы и sitemap, где нет meta-тега robots.
    if (!getSeoConfig().indexing) {
      headers.push({ key: "X-Robots-Tag", value: "noindex, nofollow" });
    }
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
