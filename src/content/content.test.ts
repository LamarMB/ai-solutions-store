import { describe, expect, it } from "vitest";
import {
  catalog,
  getCategories,
  getIndustries,
  getSolutionById,
  getSolutions,
  getSolutionsByCategory,
  getSolutionsByIndustry,
  getStartingPrice,
} from "@/catalog";

describe("данные каталога", () => {
  it("сохраняют три исходных решения первыми и содержат 13 решений", () => {
    const ids = getSolutions().map((s) => s.id);
    expect(ids.slice(0, 3)).toEqual([
      "clinic-ai-administrator",
      "document-data-extraction",
      "crm-ai-integration",
    ]);
    expect(ids).toHaveLength(13);
  });

  it("все решения помечены как демонстрационные", () => {
    for (const solution of getSolutions()) {
      expect(solution.isDemo, solution.id).toBe(true);
    }
  });

  it("содержат девять категорий и семь отраслей", () => {
    expect(getCategories()).toHaveLength(9);
    expect(getIndustries()).toHaveLength(7);
    expect(getCategories().map((c) => c.id)).toEqual(
      expect.arrayContaining(["accounting", "sales", "hr", "knowledge-search"]),
    );
    expect(getIndustries().map((i) => i.id)).toEqual(
      expect.arrayContaining(["healthcare", "restaurants"]),
    );
  });

  it("используют все три вида цены", () => {
    const kinds = new Set(
      catalog.solutions.flatMap((s) => s.packages.map((p) => p.price.kind)),
    );
    expect([...kinds].sort()).toEqual(["fixed", "from", "on_request"]);
  });

  it("находят решение по id", () => {
    expect(getSolutionById("crm-ai-integration")?.title).toBe(
      "Интеграция ИИ с CRM",
    );
    expect(getSolutionById("missing")).toBeUndefined();
  });

  it("фильтруют по категории", () => {
    expect(
      getSolutionsByCategory("document-processing").map((s) => s.id),
    ).toEqual([
      "document-data-extraction",
      "ai-accounting-department",
      "document-reconciliation",
    ]);
  });

  it("решения с пустым industryIds попадают в любую отрасль", () => {
    const ids = getSolutionsByIndustry("healthcare").map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(["clinic-ai-administrator", "crm-ai-integration"]),
    );
    expect(ids).not.toContain("restaurant-sales-analytics");
  });

  it("начальные цены демо-решений сохраняют вид цены", () => {
    expect(
      getStartingPrice(getSolutionById("clinic-ai-administrator")!),
    ).toEqual({ kind: "fixed", amount: 12000000, currency: "RUB" });
    expect(getStartingPrice(getSolutionById("crm-ai-integration")!)).toEqual({
      kind: "fixed",
      amount: 9000000,
      currency: "RUB",
    });
  });
});

describe("качество карточек решений", () => {
  const solutions = getSolutions();

  it("у каждого решения есть аудитория, задачи и возможности", () => {
    for (const s of solutions) {
      expect(s.audience.length, s.id).toBeGreaterThan(0);
      expect(s.problems.length, s.id).toBeGreaterThan(0);
      expect(s.capabilities.length, s.id).toBeGreaterThan(0);
      expect(s.limitations.length, s.id).toBeGreaterThan(0);
    }
  });

  it("названия решений не повторяются", () => {
    const titles = solutions.map((s) => s.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("концепции и решения в разработке не имеют пакетов, цен и сроков", () => {
    const notReady = solutions.filter((s) => s.maturity !== "demo");
    expect(notReady.length).toBe(10);
    for (const s of notReady) {
      expect(s.packages, s.id).toEqual([]);
      expect(getStartingPrice(s), s.id).toEqual({ kind: "on_request" });
    }
  });

  it("AI Accounting Department — в разработке, без заявлений о готовности", () => {
    const aad = getSolutionById("ai-accounting-department")!;
    expect(aad.maturity).toBe("in_development");
    expect(aad.limitations.join(" ")).toContain("не подтверждён");
    expect(aad.capabilities.join(" ")).toContain("11");
  });

  it("тексты не содержат гарантий, процентов и обещаний результата", () => {
    const forbidden = /гарант|%|процент|отзыв|кейс|клиенты довольны|окупаем/i;
    for (const s of solutions) {
      const texts = [
        s.title,
        s.summary,
        s.description,
        ...s.audience,
        ...s.problems,
        ...s.capabilities,
        ...s.limitations,
        ...s.implementationStages.flatMap((st) => [st.title, st.description]),
      ];
      for (const text of texts) expect(text, s.id).not.toMatch(forbidden);
    }
  });
});
