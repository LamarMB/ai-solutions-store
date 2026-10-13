import { describe, expect, it } from "vitest";
import { getSolutions } from "@/catalog";
import {
  catalogHref,
  EMPTY_QUERY,
  filterSolutions,
  isQueryEmpty,
  normalizeText,
  parseCatalogQuery,
  pluralRu,
  serializeCatalogQuery,
  toggleValue,
  type CatalogQuery,
} from "@/catalog/search";

const known = {
  categoryIds: ["assistants", "document-processing", "integrations"],
  industryIds: ["retail", "healthcare", "logistics"],
};

const ids = (query: Partial<CatalogQuery>) =>
  filterSolutions(getSolutions(), { ...EMPTY_QUERY, ...query }).map(
    (s) => s.id,
  );

describe("parseCatalogQuery", () => {
  it("пустые параметры дают пустой запрос", () => {
    expect(parseCatalogQuery({}, known)).toEqual(EMPTY_QUERY);
  });

  it("читает повторяющиеся параметры и значения через запятую", () => {
    const query = parseCatalogQuery(
      {
        category: ["integrations", "assistants"],
        industry: "retail,logistics",
      },
      known,
    );
    // порядок — как в справочнике
    expect(query.categories).toEqual(["assistants", "integrations"]);
    expect(query.industries).toEqual(["retail", "logistics"]);
  });

  it("отбрасывает неизвестные id и повторы", () => {
    const query = parseCatalogQuery(
      { category: ["assistants", "assistants", "<script>", "nope"] },
      known,
    );
    expect(query.categories).toEqual(["assistants"]);
  });

  it("обрезает строку поиска по краям и по длине", () => {
    expect(parseCatalogQuery({ q: "  crm  " }, known).q).toBe("crm");
    expect(parseCatalogQuery({ q: "а".repeat(500) }, known).q).toHaveLength(
      100,
    );
    expect(parseCatalogQuery({ q: ["первый", "второй"] }, known).q).toBe(
      "первый",
    );
  });
});

describe("serializeCatalogQuery / catalogHref", () => {
  it("пустой запрос — чистый адрес", () => {
    expect(serializeCatalogQuery(EMPTY_QUERY)).toBe("");
    expect(catalogHref(EMPTY_QUERY)).toBe("/catalog");
  });

  it("кодирует поиск и повторяет параметры фильтров", () => {
    expect(
      catalogHref({
        q: "ИИ ассистент",
        categories: ["assistants", "integrations"],
        industries: ["healthcare"],
      }),
    ).toBe(
      "/catalog?q=%D0%98%D0%98+%D0%B0%D1%81%D1%81%D0%B8%D1%81%D1%82%D0%B5%D0%BD%D1%82&category=assistants&category=integrations&industry=healthcare",
    );
  });

  it("разбор и сериализация обратимы", () => {
    const query: CatalogQuery = {
      q: "документы",
      categories: ["document-processing"],
      industries: ["logistics", "healthcare"],
    };
    const params = Object.fromEntries(
      ["q", "category", "industry"].map((key) => [
        key,
        new URLSearchParams(serializeCatalogQuery(query)).getAll(key),
      ]),
    );
    const parsed = parseCatalogQuery(params, known);
    expect(parsed.q).toBe(query.q);
    expect(parsed.categories).toEqual(query.categories);
    expect(new Set(parsed.industries)).toEqual(new Set(query.industries));
  });
});

describe("helpers", () => {
  it("isQueryEmpty", () => {
    expect(isQueryEmpty(EMPTY_QUERY)).toBe(true);
    expect(isQueryEmpty({ ...EMPTY_QUERY, q: "   " })).toBe(true);
    expect(isQueryEmpty({ ...EMPTY_QUERY, industries: ["retail"] })).toBe(
      false,
    );
  });

  it("toggleValue добавляет и убирает", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });

  it("normalizeText: регистр, ё, пробелы", () => {
    expect(normalizeText("  Учётная   СИСТЕМА ")).toBe("учетная система");
  });

  it.each([
    [1, "решение"],
    [2, "решения"],
    [4, "решения"],
    [5, "решений"],
    [11, "решений"],
    [12, "решений"],
    [21, "решение"],
    [22, "решения"],
    [0, "решений"],
  ])("pluralRu(%i) = %s", (n, form) => {
    expect(pluralRu(n, ["решение", "решения", "решений"])).toBe(form);
  });
});

describe("filterSolutions на данных каталога", () => {
  it("без условий возвращает все решения", () => {
    expect(ids({})).toHaveLength(3);
  });

  it("ищет по названию без учёта регистра", () => {
    expect(ids({ q: "crm" })).toEqual(["crm-ai-integration"]);
  });

  it("ищет по краткому и полному описанию", () => {
    expect(ids({ q: "накладных" })).toEqual(["document-data-extraction"]);
    expect(ids({ q: "диагнозы" })).toEqual(["clinic-ai-administrator"]);
  });

  it("учитывает «ё» и требует все слова запроса", () => {
    expect(ids({ q: "учетную систему" })).toEqual(["document-data-extraction"]);
    expect(ids({ q: "клиники накладных" })).toEqual([]);
  });

  it("фильтр по категории", () => {
    expect(ids({ categories: ["document-processing"] })).toEqual([
      "document-data-extraction",
    ]);
  });

  it("несколько категорий — «или»", () => {
    expect(ids({ categories: ["assistants", "document-processing"] })).toEqual([
      "clinic-ai-administrator",
      "document-data-extraction",
    ]);
  });

  it("решение с пустым industryIds подходит любой отрасли", () => {
    expect(ids({ industries: ["education"] })).toEqual(["crm-ai-integration"]);
    expect(ids({ industries: ["healthcare"] })).toEqual([
      "clinic-ai-administrator",
      "crm-ai-integration",
    ]);
  });

  it("категории и отрасли независимы и сочетаются через «и»", () => {
    expect(
      ids({ categories: ["integrations"], industries: ["logistics"] }),
    ).toEqual(["crm-ai-integration"]);
    expect(
      ids({ categories: ["document-processing"], industries: ["healthcare"] }),
    ).toEqual([]);
  });

  it("поиск сочетается с фильтрами", () => {
    expect(ids({ q: "ассистент", industries: ["healthcare"] })).toEqual([
      "clinic-ai-administrator",
    ]);
  });
});
