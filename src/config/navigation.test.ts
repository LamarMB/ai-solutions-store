import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { telegram } from "@/config/contact";
import {
  allNavHrefs,
  footerNav,
  headerActions,
  isActivePath,
  isExternalHref,
  mainNav,
} from "@/config/navigation";

const appDir = path.resolve(__dirname, "../app");
/** Группы маршрутов вида (site) не входят в адрес страницы. */
const routeRoots = [
  appDir,
  ...readdirSync(appDir)
    .filter((name) => /^\(.+\)$/.test(name))
    .map((name) => path.join(appDir, name)),
];

describe("навигация", () => {
  it("адреса основного меню уникальны", () => {
    const hrefs = mainNav.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it.each(allNavHrefs)("для %s существует страница", (href) => {
    // Якорь (/#tariffs) ведёт на секцию страницы — проверяем саму страницу.
    const page = href.split("#")[0];
    expect(
      routeRoots.some((root) => existsSync(path.join(root, page, "page.tsx"))),
    ).toBe(true);
  });

  it("подвал ссылается только на известные разделы", () => {
    const known = new Set<string>(allNavHrefs);
    for (const group of footerNav) {
      for (const item of group.items) {
        expect(
          known.has(item.href) || item.href === telegram.href,
          item.href,
        ).toBe(true);
      }
    }
  });

  it("действия шапки ведут на заявку и консультанта", () => {
    expect(headerActions.request.href).toBe("/request");
    expect(headerActions.consultant.href).toBe("/consultant");
  });

  it("«Получить демонстрацию» ведёт к разделу #demo (там Telegram), подвал содержит контакт", () => {
    expect(telegram.href).toBe("https://t.me/tgboostman");
    expect(headerActions.demo).toEqual({
      href: "/#demo",
      label: "Получить демонстрацию",
    });
    expect(isExternalHref(headerActions.demo.href)).toBe(false);
    expect(
      footerNav.some((g) => g.items.some((i) => i.href === telegram.href)),
    ).toBe(true);
  });
});

describe("isActivePath", () => {
  it("совпадение и вложенные страницы", () => {
    expect(isActivePath("/catalog", "/catalog")).toBe(true);
    expect(isActivePath("/catalog/crm-ai-integration", "/catalog")).toBe(true);
  });

  it("не путает разделы с общим префиксом", () => {
    expect(isActivePath("/catalogue", "/catalog")).toBe(false);
    expect(isActivePath("/", "/catalog")).toBe(false);
  });
});
