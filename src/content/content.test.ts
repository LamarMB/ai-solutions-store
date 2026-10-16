import { describe, expect, it } from "vitest";
import {
  catalog,
  getAllSolutions,
  getCategories,
  getIndustries,
  getSolutionById,
  getSolutions,
  getSolutionsByCategory,
  getSolutionsByIndustry,
  getStartingPrice,
} from "@/catalog";

const PUBLIC_IDS = [
  "clinic-ai-administrator",
  "patient-request-routing",
  "patient-ai-assistant",
];

describe("данные каталога", () => {
  it("публично — только три медицинских решения в заданном порядке", () => {
    expect(getSolutions().map((s) => s.id)).toEqual(PUBLIC_IDS);
    for (const s of getSolutions()) {
      expect(s.industryIds, s.id).toEqual(["healthcare"]);
    }
  });

  it("остальные решения скрыты, но их записи сохранены", () => {
    const all = getAllSolutions();
    expect(all).toHaveLength(14);
    const hidden = all.filter((s) => !PUBLIC_IDS.includes(s.id));
    expect(hidden).toHaveLength(11);
    for (const s of hidden) expect(s.hidden, s.id).toBe(true);
    expect(hidden.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        "document-data-extraction",
        "ai-accounting-department",
        "restaurant-order-assistant",
        "hr-assistant",
      ]),
    );
  });

  it("все решения помечены как демонстрационные", () => {
    for (const solution of getAllSolutions()) {
      expect(solution.isDemo, solution.id).toBe(true);
    }
  });

  it("публичные справочники — только используемые категории и одна отрасль", () => {
    expect(catalog.categories).toHaveLength(9);
    expect(catalog.industries).toHaveLength(7);
    const used = new Set(getSolutions().flatMap((s) => s.categoryIds));
    expect(getCategories().map((c) => c.id)).toEqual(
      catalog.categories.filter((c) => used.has(c.id)).map((c) => c.id),
    );
    expect(getIndustries().map((i) => i.id)).toEqual(["healthcare"]);
  });

  it("используют все три вида цены", () => {
    const kinds = new Set(
      getSolutions().flatMap((s) => s.packages.map((p) => p.price.kind)),
    );
    expect([...kinds].sort()).toEqual(["fixed", "from", "on_request"]);
  });

  it("скрытое решение не находится по id на публичных страницах", () => {
    expect(getSolutionById("clinic-ai-administrator")?.title).toBe(
      "ИИ-администратор клиники",
    );
    expect(getSolutionById("crm-ai-integration")).toBeUndefined();
    expect(getSolutionById("missing")).toBeUndefined();
    expect(getSolutionsByCategory("integrations").map((s) => s.id)).toEqual([
      "clinic-ai-administrator",
    ]);
    expect(getSolutionsByIndustry("restaurants")).toEqual([]);
  });
});

describe("тарифы ИИ-администратора", () => {
  const admin = getSolutionById("clinic-ai-administrator")!;
  const rub = (kind: "fixed" | "from", amount: number) => ({
    kind,
    amount,
    currency: "RUB",
  });

  it("Старт, Оптимум, Бизнес — внедрение и обслуживание как согласовано", () => {
    expect(
      admin.packages.map((p) => [p.title, p.price, p.monthlyPrice]),
    ).toEqual([
      ["Старт", rub("fixed", 1500000), rub("fixed", 390000)],
      ["Оптимум", rub("fixed", 3500000), rub("fixed", 790000)],
      ["Бизнес", rub("from", 7500000), rub("from", 1490000)],
    ]);
    expect(getStartingPrice(admin)).toEqual(rub("fixed", 1500000));
  });

  it("рекомендуемый — только «Оптимум»; цены помечены как предварительные", () => {
    expect(
      admin.packages.filter((p) => p.recommended).map((p) => p.id),
    ).toEqual(["optimum"]);
    expect(admin.pricingNote).toMatch(/предварительные/);
  });

  it("заявка отделена от подтверждённой записи, мгновенная запись не обещается", () => {
    const optimum = admin.packages.find((p) => p.id === "optimum")!;
    expect(optimum.includes.join(" ")).toMatch(
      /заявок.*запись подтверждает администратор/,
    );
    expect(admin.limitations.join(" ")).toMatch(/Без интеграции/);
    const texts = [
      admin.description,
      ...admin.capabilities,
      ...admin.packages.flatMap((p) => [p.summary, ...p.includes]),
    ].join(" ");
    expect(texts).not.toMatch(/мгновенн/i);
  });
});

describe("медицинские решения", () => {
  it("ни одно решение не ставит диагнозы и не даёт медицинских рекомендаций", () => {
    for (const s of getSolutions()) {
      expect(s.limitations.join(" "), s.id).toMatch(
        /не ставит диагнозы|Не оценивает состояние здоровья/i,
      );
    }
  });

  it("ИИ-помощник пациента — концепция без пакетов, с согласием пациента", () => {
    const assistant = getSolutionById("patient-ai-assistant")!;
    expect(assistant.maturity).toBe("concept");
    expect(assistant.packages).toEqual([]);
    const limits = assistant.limitations.join(" ");
    expect(limits).toMatch(/не реализован/);
    expect(limits).toMatch(/согласи/);
    expect(limits).toMatch(/специальная категория/);
  });
});

describe("качество карточек решений", () => {
  const solutions = getAllSolutions();

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
    const aad = getAllSolutions().find(
      (s) => s.id === "ai-accounting-department",
    )!;
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
