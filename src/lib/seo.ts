import type { Metadata } from "next";
import { getSeoConfig, type SeoConfig } from "@/lib/seo-config";
import { site } from "@/lib/site";

export { getSeoConfig, type SeoConfig };

/**
 * Публичные страницы для sitemap. Заявка и политика — служебные (noindex),
 * `/ui` — только в режиме разработки; страницы решений добавляются из каталога.
 */
export const INDEXABLE_PAGES = [
  "/",
  "/catalog",
  "/industries",
  "/how-we-work",
  "/about",
  "/consultant",
] as const;

/** Картинка для соцсетей и мессенджеров (`public/og-image.png`). */
export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "AI Solutions Store — внедрение ИИ и автоматизация бизнеса. Демо-версия сайта.",
};

/** Абсолютный адрес страницы сайта. */
export function absoluteUrl(path: string, config = getSeoConfig()): string {
  return new URL(path, config.baseUrl).toString();
}

export type PageSeo = {
  title: string;
  description: string;
  /** Путь страницы без параметров — он же canonical. */
  path: string;
  /** Страница не должна попадать в поиск даже после включения индексации. */
  noindex?: boolean;
  /** Заголовок без шаблона « · AI Solutions Store». */
  absoluteTitle?: boolean;
};

/**
 * Метаданные страницы: title, description, canonical, robots, Open Graph и
 * Twitter Card. Open Graph задаётся целиком: Next.js не сливает его с родительским.
 */
export function pageMetadata(
  { title, description, path, noindex = false, absoluteTitle = false }: PageSeo,
  config = getSeoConfig(),
): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} · ${site.name}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    robots: robotsFor(noindex, config),
    openGraph: {
      type: "website",
      locale: "ru_RU",
      siteName: site.name,
      title: fullTitle,
      description,
      url: path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [OG_IMAGE],
    },
  };
}

export function robotsFor(
  noindex: boolean,
  config: SeoConfig,
): Metadata["robots"] {
  if (!config.indexing) return { index: false, follow: false };
  return noindex
    ? { index: false, follow: true }
    : { index: true, follow: true };
}

/** JSON-LD для `<script type="application/ld+json">` без возможности XSS. */
export function jsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
