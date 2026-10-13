import { describe, expect, it } from "vitest";
import {
  PackageSchema,
  PriceSchema,
  SolutionSchema,
  type SolutionInput,
} from "@/catalog/schema";

const validPackage = {
  id: "basic",
  title: "Базовый",
  summary: "Описание пакета",
  price: { kind: "fixed", amount: 100000, currency: "RUB" },
  includes: ["Работа"],
} satisfies SolutionInput["packages"][number];

const validSolution = {
  id: "test-solution",
  isDemo: true,
  title: "Решение",
  summary: "Кратко",
  description: "Подробно",
  categoryIds: ["assistants"],
  industryIds: [],
  packages: [validPackage],
  implementationStages: [{ title: "Этап", description: "Описание этапа" }],
  dataRequirements: ["Данные"],
  accessRequirements: ["Доступ"],
  limitations: ["Ограничение"],
  tags: [],
} satisfies SolutionInput;

describe("PriceSchema", () => {
  it.each([
    { kind: "fixed", amount: 15000000, currency: "RUB" },
    { kind: "from", amount: 1, currency: "RUB" },
    { kind: "on_request" },
  ])("принимает корректную цену %o", (price) => {
    expect(PriceSchema.parse(price)).toEqual(price);
  });

  it.each([
    ["дробную сумму", { kind: "fixed", amount: 100.5, currency: "RUB" }],
    ["нулевую сумму", { kind: "fixed", amount: 0, currency: "RUB" }],
    ["отрицательную сумму", { kind: "from", amount: -100, currency: "RUB" }],
    ["сумму строкой", { kind: "fixed", amount: "100", currency: "RUB" }],
    ["неизвестную валюту", { kind: "fixed", amount: 100, currency: "USD" }],
    ["цену без валюты", { kind: "fixed", amount: 100 }],
    ["цену «от» без суммы", { kind: "from", currency: "RUB" }],
    ["«по запросу» с суммой", { kind: "on_request", amount: 100 }],
    ["неизвестный вид цены", { kind: "free" }],
    [
      "лишнее поле",
      { kind: "fixed", amount: 100, currency: "RUB", discount: 10 },
    ],
  ])("отклоняет %s", (_, price) => {
    expect(PriceSchema.safeParse(price).success).toBe(false);
  });
});

describe("PackageSchema", () => {
  it("принимает корректный пакет со сроками", () => {
    const pkg = { ...validPackage, duration: { minWeeks: 2, maxWeeks: 4 } };
    expect(PackageSchema.safeParse(pkg).success).toBe(true);
  });

  it("отклоняет minWeeks > maxWeeks", () => {
    const pkg = { ...validPackage, duration: { minWeeks: 5, maxWeeks: 4 } };
    expect(PackageSchema.safeParse(pkg).success).toBe(false);
  });

  it("отклоняет пустой состав работ", () => {
    expect(
      PackageSchema.safeParse({ ...validPackage, includes: [] }).success,
    ).toBe(false);
  });
});

describe("SolutionSchema", () => {
  it("принимает корректное решение", () => {
    expect(SolutionSchema.safeParse(validSolution).success).toBe(true);
  });

  it("принимает пустой industryIds (любая отрасль)", () => {
    const result = SolutionSchema.parse({ ...validSolution, industryIds: [] });
    expect(result.industryIds).toEqual([]);
  });

  it("требует явный isDemo", () => {
    const withoutIsDemo: Partial<SolutionInput> = { ...validSolution };
    delete withoutIsDemo.isDemo;
    expect(SolutionSchema.safeParse(withoutIsDemo).success).toBe(false);
  });

  it.each([
    ["пустой список пакетов", { packages: [] }],
    ["пустой список категорий", { categoryIds: [] }],
    ["неверный slug", { id: "Test Solution" }],
    ["slug с двойным дефисом", { id: "test--solution" }],
    ["пустой заголовок", { title: "   " }],
    ["пустые ограничения", { limitations: [] }],
    ["пустые этапы внедрения", { implementationStages: [] }],
    ["неизвестное поле", { rating: 5 }],
  ])("отклоняет %s", (_, patch) => {
    expect(
      SolutionSchema.safeParse({ ...validSolution, ...patch }).success,
    ).toBe(false);
  });

  it("отклоняет повторяющиеся id пакетов", () => {
    const result = SolutionSchema.safeParse({
      ...validSolution,
      packages: [validPackage, { ...validPackage, title: "Другой" }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('"basic"');
  });

  it("отклоняет повторяющиеся категории", () => {
    const result = SolutionSchema.safeParse({
      ...validSolution,
      categoryIds: ["assistants", "assistants"],
    });
    expect(result.success).toBe(false);
  });
});
