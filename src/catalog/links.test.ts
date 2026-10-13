import { describe, expect, it } from "vitest";
import { getSolutions } from "@/catalog";
import {
  formatDuration,
  requestHref,
  resolveRequestSelection,
  solutionHref,
} from "@/catalog/links";

describe("ссылки", () => {
  it("адрес страницы решения", () => {
    expect(solutionHref("crm-ai-integration")).toBe(
      "/catalog/crm-ai-integration",
    );
  });

  it("адрес заявки передаёт solutionId и packageId", () => {
    expect(requestHref("crm-ai-integration", "audit")).toBe(
      "/request?solution=crm-ai-integration&package=audit",
    );
    expect(requestHref("crm-ai-integration")).toBe(
      "/request?solution=crm-ai-integration",
    );
  });
});

describe("resolveRequestSelection", () => {
  const solutions = getSolutions();

  it("находит решение и пакет", () => {
    const result = resolveRequestSelection(
      { solution: "document-data-extraction", package: "turnkey" },
      solutions,
    );
    expect(result?.solution.id).toBe("document-data-extraction");
    expect(result?.package?.id).toBe("turnkey");
  });

  it("неизвестное решение — null", () => {
    expect(resolveRequestSelection({ solution: "nope" }, solutions)).toBeNull();
    expect(resolveRequestSelection({}, solutions)).toBeNull();
  });

  it("пакет чужого решения или неизвестный пакет отбрасывается", () => {
    const result = resolveRequestSelection(
      { solution: "crm-ai-integration", package: "turnkey" },
      solutions,
    );
    expect(result?.solution.id).toBe("crm-ai-integration");
    expect(result?.package).toBeUndefined();
  });

  it("берёт первое значение повторяющегося параметра", () => {
    const result = resolveRequestSelection(
      { solution: ["crm-ai-integration", "x"], package: ["audit", "y"] },
      solutions,
    );
    expect(result?.package?.id).toBe("audit");
  });
});

describe("formatDuration", () => {
  it.each([
    [{ minWeeks: 3, maxWeeks: 5 }, "3–5 недель"],
    [{ minWeeks: 2, maxWeeks: 3 }, "2–3 недели"],
    [{ minWeeks: 2, maxWeeks: 2 }, "2 недели"],
    [{ minWeeks: 1, maxWeeks: 1 }, "1 неделя"],
    [{ minWeeks: 8, maxWeeks: 14 }, "8–14 недель"],
  ])("%o → %s", (duration, text) => {
    expect(formatDuration(duration)).toBe(text);
  });
});
