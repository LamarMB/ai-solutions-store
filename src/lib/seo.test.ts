import { afterEach, describe, expect, it, vi } from "vitest";
import { getSolutions } from "@/catalog";
import { solutionSeoDescription, solutionSeoTitle } from "@/catalog/seo";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { breadcrumbJsonLd } from "@/components/ui/Breadcrumbs";
import {
  absoluteUrl,
  getSeoConfig,
  INDEXABLE_PAGES,
  jsonLd,
  MAX_TITLE_LENGTH,
  OG_IMAGE,
  pageMetadata,
} from "@/lib/seo";

const PROD = { SITE_URL: "https://example.ru", SITE_INDEXING: "true" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSeoConfig", () => {
  it("по умолчанию индексация выключена, адрес локальный", () => {
    const config = getSeoConfig({});
    expect(config.indexing).toBe(false);
    expect(config.hasSiteUrl).toBe(false);
    expect(config.baseUrl.origin).toBe("http://localhost:3000");
  });

  it("адрес без SITE_INDEXING не включает индексацию", () => {
    const config = getSeoConfig({ SITE_URL: "https://example.ru" });
    expect(config.indexing).toBe(false);
    expect(config.baseUrl.toString()).toBe("https://example.ru/");
  });

  it.each([
    ["без адреса", { SITE_INDEXING: "true" }],
    [
      "с http-адресом",
      { SITE_URL: "http://example.ru", SITE_INDEXING: "true" },
    ],
    ["с некорректным адресом", { SITE_URL: "example", SITE_INDEXING: "true" }],
    [
      "с другим значением флага",
      { SITE_URL: "https://example.ru", SITE_INDEXING: "1" },
    ],
  ])("индексация не включается %s", (_, env) => {
    expect(getSeoConfig(env).indexing).toBe(false);
  });

  it("https-адрес и SITE_INDEXING=true включают индексацию; путь отбрасывается", () => {
    const config = getSeoConfig({
      ...PROD,
      SITE_URL: "https://example.ru/x?y#z",
    });
    expect(config.indexing).toBe(true);
    expect(absoluteUrl("/catalog", config)).toBe("https://example.ru/catalog");
  });
});

describe("robots.txt", () => {
  it("в демо-режиме закрывает сайт и не раскрывает sitemap", () => {
    const result = robots();
    expect(result.rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(result.sitemap).toBeUndefined();
  });

  it("после включения индексации открывает сайт и указывает sitemap", () => {
    vi.stubEnv("SITE_URL", PROD.SITE_URL);
    vi.stubEnv("SITE_INDEXING", PROD.SITE_INDEXING);
    const result = robots();
    expect(result.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(result.sitemap).toBe("https://example.ru/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  it("содержит публичные страницы и все решения каталога с абсолютными адресами", () => {
    vi.stubEnv("SITE_URL", PROD.SITE_URL);
    const urls = sitemap().map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const path of INDEXABLE_PAGES) {
      expect(urls).toContain(new URL(path, PROD.SITE_URL).toString());
    }
    for (const solution of getSolutions()) {
      expect(urls).toContain(`https://example.ru/catalog/${solution.id}`);
    }
    expect(urls).toHaveLength(INDEXABLE_PAGES.length + getSolutions().length);
  });

  it("не содержит служебных страниц и выдуманных дат", () => {
    const entries = sitemap();
    for (const { url, lastModified } of entries) {
      expect(url).not.toMatch(/\/(request|privacy|ui)(\/|$|\?)/);
      expect(lastModified).toBeUndefined();
    }
  });
});

describe("pageMetadata", () => {
  const page = {
    title: "Каталог",
    description: "Описание страницы",
    path: "/catalog",
  };

  it("canonical, Open Graph и Twitter Card", () => {
    const meta = pageMetadata(page, getSeoConfig(PROD));
    expect(meta.title).toBe("Каталог");
    expect(meta.alternates?.canonical).toBe("/catalog");
    expect(meta.openGraph).toMatchObject({
      locale: "ru_RU",
      title: "Каталог · AI Solutions Store",
      description: page.description,
      url: "/catalog",
      images: [OG_IMAGE],
    });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      images: [OG_IMAGE],
    });
  });

  it("в демо-режиме — noindex, nofollow для всех страниц", () => {
    expect(pageMetadata(page, getSeoConfig({})).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("после включения индексации служебные страницы остаются noindex", () => {
    const config = getSeoConfig(PROD);
    expect(pageMetadata(page, config).robots).toEqual({
      index: true,
      follow: true,
    });
    expect(pageMetadata({ ...page, noindex: true }, config).robots).toEqual({
      index: false,
      follow: true,
    });
  });

  it("длинный заголовок — без названия сайта", () => {
    const title = "Внутренний HR-ассистент и адаптация сотрудников (концепция)";
    const meta = pageMetadata({ ...page, title });
    expect(meta.title).toEqual({ absolute: title });
    expect(meta.openGraph?.title).toBe(title);
  });

  it("absoluteTitle не добавляет название сайта", () => {
    const meta = pageMetadata({ ...page, absoluteTitle: true });
    expect(meta.title).toEqual({ absolute: "Каталог" });
    expect(meta.openGraph?.title).toBe("Каталог");
  });
});

describe("SEO страниц решений", () => {
  it("концепции и продукты в разработке помечены в заголовке и начале описания", () => {
    for (const solution of getSolutions()) {
      const title = solutionSeoTitle(solution);
      const description = solutionSeoDescription(solution);
      if (solution.maturity === "concept") {
        expect(title).toMatch(/\(концепция\)$/);
        expect(description).toMatch(/^Концепция, готового продукта нет\./);
      } else if (solution.maturity === "in_development") {
        expect(title).toMatch(/\(в разработке\)$/);
        expect(description).toMatch(/^В разработке, не готово/);
      } else {
        expect(title).toBe(solution.title);
      }
    }
  });

  it("итоговый title не длиннее ориентира", () => {
    for (const solution of getSolutions()) {
      const meta = pageMetadata({
        title: solutionSeoTitle(solution),
        description: solutionSeoDescription(solution),
        path: `/catalog/${solution.id}`,
      });
      expect(
        String(meta.openGraph?.title).length,
        solution.id,
      ).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    }
  });

  it("заголовки и описания уникальны", () => {
    const titles = getSolutions().map(solutionSeoTitle);
    const descriptions = getSolutions().map(solutionSeoDescription);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});

describe("структурированные данные", () => {
  it("BreadcrumbList: позиции по порядку, у текущей страницы нет адреса", () => {
    vi.stubEnv("SITE_URL", PROD.SITE_URL);
    const data = breadcrumbJsonLd([
      { label: "Главная", href: "/" },
      { label: "Каталог", href: "/catalog" },
      { label: "Решение" },
    ]);
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Главная",
          item: "https://example.ru/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Каталог",
          item: "https://example.ru/catalog",
        },
        { "@type": "ListItem", position: 3, name: "Решение" },
      ],
    });
  });

  it("jsonLd экранирует «<», чтобы данные не закрыли тег script", () => {
    const out = jsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("метаданные публичных страниц", () => {
  it("у каждой страницы свои title, description и canonical", async () => {
    const pages = await Promise.all(
      [
        import("@/app/page"),
        import("@/app/catalog/page"),
        import("@/app/industries/page"),
        import("@/app/how-we-work/page"),
        import("@/app/about/page"),
        import("@/app/consultant/page"),
        import("@/app/request/page"),
        import("@/app/privacy/page"),
      ].map(async (m) => (await m).metadata),
    );
    const titles = pages.map((m) => JSON.stringify(m.title));
    const descriptions = pages.map((m) => m.description);
    const canonicals = pages.map((m) => m.alternates?.canonical);
    expect(new Set(titles).size).toBe(pages.length);
    expect(new Set(descriptions).size).toBe(pages.length);
    expect(new Set(canonicals).size).toBe(pages.length);
    for (const meta of pages) {
      expect(meta.description!.length).toBeGreaterThan(50);
      expect(meta.description!.length).toBeLessThanOrEqual(220);
      expect(meta.openGraph?.images).toEqual([OG_IMAGE]);
    }
  });
});
