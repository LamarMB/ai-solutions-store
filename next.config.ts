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
