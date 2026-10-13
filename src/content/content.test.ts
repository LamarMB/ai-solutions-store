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
  it("содержат три демо-решения", () => {
    expect(getSolutions().map((s) => s.id)).toEqual([
      "clinic-ai-administrator",
      "document-data-extraction",
      "crm-ai-integration",
    ]);
  });

  it("все решения помечены как демонстрационные", () => {
    for (const solution of getSolutions()) {
      expect(solution.isDemo, solution.id).toBe(true);
    }
  });

  it("содержат пять категорий и шесть отраслей", () => {
    expect(getCategories()).toHaveLength(5);
    expect(getIndustries()).toHaveLength(6);
    expect(getIndustries().map((i) => i.id)).toContain("healthcare");
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
    ).toEqual(["document-data-extraction"]);
  });

  it("решения с пустым industryIds попадают в любую отрасль", () => {
    const ids = getSolutionsByIndustry("healthcare").map((s) => s.id);
    expect(ids).toEqual(["clinic-ai-administrator", "crm-ai-integration"]);
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
