import { describe, expect, it } from "vitest";
import { getCategories, getIndustries, getSolutions } from "@/catalog";
import {
  catalogHref,
  EMPTY_QUERY,
  filterSolutions,
  parseCatalogQuery,
} from "@/catalog/search";
import { principles, processSteps } from "@/content/approach";
import { directions, industryIcons } from "@/content/directions";

const known = {
  categoryIds: getCategories().map((c) => c.id),
  industryIds: getIndustries().map((i) => i.id),
};

describe("направления на главной", () => {
  it.each(directions.map((d) => [d.id, d] as const))(
    "%s ведёт в каталог с валидным фильтром и непустым результатом",
    (_, direction) => {
      const query = { ...EMPTY_QUERY, ...direction.query };
      const href = catalogHref(query);
      expect(href.startsWith("/catalog?")).toBe(true);

      // Фильтр переживает разбор URL без потерь — значит, id существуют.
      const params = new URLSearchParams(href.split("?")[1]);
      const parsed = parseCatalogQuery(
        {
          q: params.get("q") ?? undefined,
          category: params.getAll("category"),
          industry: params.getAll("industry"),
        },
        known,
      );
      expect(parsed).toEqual(query);
      expect(filterSolutions(getSolutions(), query).length).toBeGreaterThan(0);
    },
  );

  it("направления уникальны и включают медицину, продажи и документы", () => {
    const ids = directions.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(["healthcare", "sales", "documents"]),
    );
  });

  it("у каждой отрасли есть иконка", () => {
    for (const id of known.industryIds) {
      expect(industryIcons[id], id).toBeDefined();
    }
  });
});

describe("подход", () => {
  it("процесс: анализ → подбор → внедрение → поддержка", () => {
    expect(processSteps.map((s) => s.title)).toEqual([
      "Анализ задачи",
      "Подбор решения",
      "Внедрение",
      "Поддержка",
    ]);
    for (const step of processSteps) {
      expect(step.activities.length).toBeGreaterThan(0);
      expect(step.fromClient.length).toBeGreaterThan(0);
    }
  });

  it("тексты не содержат цифр, процентов и обещаний результата", () => {
    const texts = [
      ...principles.flatMap((p) => [p.title, p.text]),
      ...processSteps.flatMap((s) => [
        s.title,
        s.summary,
        s.outcome,
        ...s.activities,
        ...s.fromClient,
      ]),
      ...directions.flatMap((d) => [d.title, d.description]),
    ];
    for (const text of texts) {
      expect(text, text).not.toMatch(
        /\d|%|гарант|клиент[ао]в? довол|рост|экономи[яи]/i,
      );
    }
  });
});
