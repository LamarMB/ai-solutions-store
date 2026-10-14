import type { NextConfig } from "next";
import { getSeoConfig } from "./src/lib/seo-config";

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
    // Пока индексация не включена, запрет дублируется заголовком для всех ответов,
    // включая файлы и sitemap, где нет meta-тега robots.
    if (getSeoConfig().indexing) return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
