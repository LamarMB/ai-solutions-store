import { describe, expect, it } from "vitest";
import { parseCatalog, type CatalogInput } from "@/catalog/catalog";

function makeCatalog(): CatalogInput {
  return {
    categories: [
      { id: "assistants", title: "Ассистенты", description: "Описание" },
    ],
    industries: [{ id: "retail", title: "Розница", description: "Описание" }],
    solutions: [
      {
        id: "test-solution",
        isDemo: true,
        title: "Решение",
        summary: "Кратко",
        description: "Подробно",
        categoryIds: ["assistants"],
        industryIds: ["retail"],
        packages: [
          {
            id: "basic",
            title: "Базовый",
            summary: "Пакет",
            price: { kind: "on_request" },
            includes: ["Работа"],
          },
        ],
        implementationStages: [{ title: "Этап", description: "Описание" }],
        dataRequirements: ["Данные"],
        accessRequirements: ["Доступ"],
        limitations: ["Ограничение"],
        tags: [],
      },
    ],
  };
}

describe("parseCatalog", () => {
  it("принимает корректный каталог", () => {
    expect(() => parseCatalog(makeCatalog())).not.toThrow();
  });

  it("отклоняет ссылку на несуществующую категорию и называет её", () => {
    const catalog = makeCatalog();
    catalog.solutions[0].categoryIds = ["missing-category"];
    expect(() => parseCatalog(catalog)).toThrow(/missing-category/);
  });

  it("отклоняет ссылку на несуществующую отрасль и называет её", () => {
    const catalog = makeCatalog();
    catalog.solutions[0].industryIds = ["missing-industry"];
    expect(() => parseCatalog(catalog)).toThrow(/missing-industry/);
  });

  it("отклоняет повторяющиеся id решений", () => {
    const catalog = makeCatalog();
    catalog.solutions.push({ ...catalog.solutions[0] });
    expect(() => parseCatalog(catalog)).toThrow(/test-solution/);
  });

  it("отклоняет повторяющиеся id категорий", () => {
    const catalog = makeCatalog();
    catalog.categories.push({ ...catalog.categories[0] });
    expect(() => parseCatalog(catalog)).toThrow(/assistants/);
  });

  it("отклоняет повторяющиеся id отраслей", () => {
    const catalog = makeCatalog();
    catalog.industries.push({ ...catalog.industries[0] });
    expect(() => parseCatalog(catalog)).toThrow(/retail/);
  });

  it("категории и отрасли независимы: id может совпадать в разных справочниках", () => {
    const catalog = makeCatalog();
    catalog.industries.push({
      id: "assistants",
      title: "Отрасль",
      description: "Совпадает по id с категорией",
    });
    expect(() => parseCatalog(catalog)).not.toThrow();
  });
});
