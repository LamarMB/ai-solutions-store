import type { MetadataRoute } from "next";
import { getSolutions } from "@/catalog";
import { solutionHref } from "@/catalog/links";
import { absoluteUrl, getSeoConfig, INDEXABLE_PAGES } from "@/lib/seo";

/**
 * Публичные страницы и страницы всех решений каталога. Дата изменения не
 * указывается: достоверной даты у записей каталога нет.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const config = getSeoConfig();
  const paths = [
    ...INDEXABLE_PAGES,
    ...getSolutions().map((s) => solutionHref(s.id)),
  ];
  return paths.map((path) => ({ url: absoluteUrl(path, config) }));
}
