import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allNavHrefs,
  footerNav,
  headerActions,
  isActivePath,
  mainNav,
} from "@/config/navigation";

const appDir = path.resolve(__dirname, "../app");

describe("навигация", () => {
  it("адреса основного меню уникальны", () => {
    const hrefs = mainNav.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it.each(allNavHrefs)("для %s существует страница", (href) => {
    // Якорь (/#tariffs) ведёт на секцию страницы — проверяем саму страницу.
    const page = href.split("#")[0];
    expect(existsSync(path.join(appDir, page, "page.tsx"))).toBe(true);
  });

  it("подвал ссылается только на известные разделы", () => {
    const known = new Set(allNavHrefs);
    for (const group of footerNav) {
      for (const item of group.items) {
        expect(known.has(item.href), item.href).toBe(true);
      }
    }
  });

  it("действия шапки ведут на заявку и консультанта", () => {
    expect(headerActions.request.href).toBe("/request");
    expect(headerActions.consultant.href).toBe("/consultant");
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
