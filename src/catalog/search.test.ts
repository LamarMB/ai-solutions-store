import { describe, expect, it } from "vitest";
// Механика проверяется на всех записях, включая скрытые.
import { getAllSolutions as getSolutions } from "@/catalog";
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
  const all = getSolutions();

  it("без условий возвращает все решения", () => {
    expect(ids({})).toHaveLength(all.length);
  });

  it("ищет без учёта регистра по названию, описанию и тегам", () => {
    expect(ids({ q: "crm" })).toEqual([
      "crm-ai-integration",
      "lead-qualification",
    ]);
  });

  it("ищет по краткому и полному описанию", () => {
    expect(ids({ q: "накладных" })).toEqual(["document-data-extraction"]);
    expect(ids({ q: "ставит диагнозы" })).toEqual(
      expect.arrayContaining(["clinic-ai-administrator"]),
    );
  });

  it("ищет по возможностям и тегам", () => {
    expect(ids({ q: "аллергенах" })).toEqual(["restaurant-order-assistant"]);
    expect(ids({ q: "онбординг" })).toEqual(["hr-assistant"]);
  });

  it("учитывает «ё» и требует все слова запроса", () => {
    expect(ids({ q: "учетную систему" })).toEqual(["document-data-extraction"]);
    expect(ids({ q: "клиники накладных" })).toEqual([]);
  });

  it("фильтр по категории — каждый результат в категории, ничего не потеряно", () => {
    const result = ids({ categories: ["document-processing"] });
    expect(result).toEqual(
      all
        .filter((s) => s.categoryIds.includes("document-processing"))
        .map((s) => s.id),
    );
    expect(result).toContain("document-data-extraction");
  });

  it("несколько категорий — «или»", () => {
    const cats = ["assistants", "document-processing"];
    expect(ids({ categories: cats })).toEqual(
      all
        .filter((s) => s.categoryIds.some((c) => cats.includes(c)))
        .map((s) => s.id),
    );
  });

  it("решение с пустым industryIds подходит любой отрасли", () => {
    const result = ids({ industries: ["education"] });
    expect(result).toEqual(
      all
        .filter(
          (s) =>
            s.industryIds.length === 0 || s.industryIds.includes("education"),
        )
        .map((s) => s.id),
    );
    expect(result).toContain("crm-ai-integration");
    expect(result).not.toContain("clinic-ai-administrator");
  });

  it("отраслевые решения не попадают в чужую отрасль", () => {
    const result = ids({ industries: ["healthcare"] });
    expect(result).toEqual(
      expect.arrayContaining([
        "clinic-ai-administrator",
        "patient-request-routing",
        "crm-ai-integration",
      ]),
    );
    expect(result).not.toContain("restaurant-order-assistant");
  });

  it("категории и отрасли независимы и сочетаются через «и»", () => {
    expect(
      ids({ categories: ["integrations"], industries: ["logistics"] }),
    ).toEqual(["crm-ai-integration"]);
    const docsInHealthcare = ids({
      categories: ["document-processing"],
      industries: ["healthcare"],
    });
    expect(docsInHealthcare).not.toContain("document-data-extraction");
    for (const id of docsInHealthcare) {
      const s = all.find((x) => x.id === id)!;
      expect(s.categoryIds).toContain("document-processing");
      expect(
        s.industryIds.length === 0 || s.industryIds.includes("healthcare"),
      ).toBe(true);
    }
  });

  it("поиск сочетается с фильтрами", () => {
    expect(ids({ q: "администратор", industries: ["healthcare"] })).toContain(
      "clinic-ai-administrator",
    );
    expect(
      ids({ q: "администратор", industries: ["restaurants"] }),
    ).not.toContain("clinic-ai-administrator");
  });
});
