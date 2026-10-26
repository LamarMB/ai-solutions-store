import { describe, expect, it } from "vitest";
import { getSolutionById, getSolutions } from "@/catalog";
import { principles, processSteps } from "@/content/approach";
import { directions } from "@/content/directions";

describe("задачи клиники на главной", () => {
  it.each(directions.map((d) => [d.id, d] as const))(
    "%s ведёт на публичное решение каталога",
    (_, direction) => {
      expect(getSolutionById(direction.solutionId)).toBeDefined();
    },
  );

  it("задачи уникальны и покрывают все публичные решения", () => {
    const ids = directions.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(directions.map((d) => d.solutionId))).toEqual(
      new Set(getSolutions().map((s) => s.id)),
    );
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
