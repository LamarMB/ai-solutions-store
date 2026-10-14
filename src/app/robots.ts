import type { MetadataRoute } from "next";
import { absoluteUrl, getSeoConfig } from "@/lib/seo";

/**
 * Пока индексация не включена (`SITE_INDEXING`, `SITE_URL`), сайт закрыт для всех
 * роботов. После включения — открыт, со ссылкой на sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  const config = getSeoConfig();
  if (!config.indexing) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: absoluteUrl("/sitemap.xml", config),
  };
}
