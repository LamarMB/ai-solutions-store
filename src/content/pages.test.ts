import { describe, expect, it } from "vitest";
import { getSolutionById, getSolutions } from "@/catalog";
import { principles, processSteps } from "@/content/approach";
import { directions } from "@/content/directions";
import { patientJourney } from "@/content/patient-journey";

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

describe("сценарий пациента", () => {
  it("запись завершается до необязательных шагов", () => {
    const optional = patientJourney.map((s) => "optional" in s && s.optional);
    expect(optional).toEqual([false, false, false, true, true]);
    // После подтверждения пациент может закрыть приложение.
    expect(patientJourney[2].text).toMatch(/подтверждение/);
    expect(patientJourney[3].text).toMatch(/пропустить/);
  });

  it("подтверждённая запись — только при интеграции, сводка — с согласия", () => {
    expect(patientJourney[1].text).toMatch(/интеграци/);
    expect(patientJourney[4].text).toMatch(/согласи/);
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
      ...patientJourney.flatMap((s) => [s.title, s.text]),
    ];
    for (const text of texts) {
      expect(text, text).not.toMatch(
        /\d|%|гарант|клиент[ао]в? довол|рост|экономи[яи]/i,
      );
    }
  });
});
