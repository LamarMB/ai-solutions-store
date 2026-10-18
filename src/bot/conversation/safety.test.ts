import { describe, expect, it } from "vitest";
import {
  detectDuration,
  detectRedFlags,
  detectTrauma,
  isMedicalAdviceRequest,
  isUnsafeReply,
  urgencyOf,
} from "@/bot/conversation/safety";

describe("тревожные признаки", () => {
  it.each([
    [
      "после падения колено сильно опухло, не могу наступить",
      ["cannot_bear_weight", "severe_swelling"],
    ],
    ["нога неестественно согнута", ["deformity"]],
    ["видна деформация сустава", ["deformity"]],
    ["кровь не останавливается уже полчаса", ["heavy_bleeding"]],
    ["сильное кровотечение из пореза", ["heavy_bleeding"]],
    ["внезапно онемела рука", ["sudden_numbness"]],
    ["перестал чувствовать... вообще не чувствую ногу", ["sudden_numbness"]],
    ["попал в ДТП, болит шея", ["severe_trauma"]],
    ["упал с лестницы", ["severe_trauma"]],
    ["кажется, перелом", ["severe_trauma"]],
    ["давит в груди и отдаёт в руку", ["chest_pain"]],
    ["болит сердце", ["chest_pain"]],
    ["задыхаюсь", ["breathing_difficulty"]],
    ["трудно дышать", ["breathing_difficulty"]],
    ["вчера потерял сознание", ["fainting"]],
    ["у мамы перекосило лицо", ["stroke_signs"]],
    ["нет, не могу наступить на ногу", ["cannot_bear_weight"]],
    ["трудно наступать на ногу", ["cannot_bear_weight"]],
  ])("«%s»", (text, flags) => {
    expect(detectRedFlags(text)).toEqual(expect.arrayContaining(flags));
  });

  it.each([
    "отёка нет",
    "сильного отёка нет",
    "нет сильного отёка",
    "без сильного отёка и деформации",
    "отёк не сильный",
    "не сильно опухло",
    "деформации нет, наступать могу",
    "наступать могу, просто ноет",
    "кровотечения не было",
    "сознание не терял",
    "обморока не было",
    "перелома нет",
    "сломалась пломба",
    "болит колено уже три дня",
    "иногда ноет колено",
    "дышать не трудно",
    "болит горло",
    "нет, просто иногда ноет",
  ])("ложного срабатывания нет: «%s»", (text) => {
    expect(detectRedFlags(text)).toEqual([]);
  });

  it("отрицание действует только внутри своей фразы", () => {
    expect(detectRedFlags("отёка нет, но не могу наступить")).toEqual([
      "cannot_bear_weight",
    ]);
    expect(detectRedFlags("травмы не было. колено сильно опухло")).toEqual([
      "severe_swelling",
    ]);
  });
});

describe("травма и длительность", () => {
  it.each([
    ["упал на колено вчера", "yes"],
    ["подвернул ногу", "yes"],
    ["после падения", "yes"],
    ["без травмы", "no"],
    ["травмы не было", "no"],
    ["не ударялся и не падал", "no"],
    ["заболело само по себе", "no"],
    ["болит колено", undefined],
  ] as const)("«%s» → %s", (text, trauma) => {
    expect(detectTrauma(text)).toBe(trauma);
  });

  it.each([
    ["уже дня четыре", "дня четыре"],
    ["три дня", "три дня"],
    ["болит 2 недели", "2 недели"],
    ["со вчера", "со вчера"],
    ["уже неделю", "уже неделю"],
    ["болит колено", undefined],
  ])("«%s» → %s", (text, duration) => {
    expect(detectDuration(text)).toBe(duration);
  });
});

describe("срочность", () => {
  it("экстренные признаки не зависят от травмы", () => {
    expect(urgencyOf({ redFlags: ["sudden_numbness"], trauma: "no" })).toBe(
      "emergency",
    );
    expect(urgencyOf({ redFlags: ["cannot_bear_weight"] })).toBe("emergency");
  });

  it("травма без признаков — «пораньше», сильный отёк после травмы — срочно", () => {
    expect(urgencyOf({ redFlags: [], trauma: "yes" })).toBe("soon");
    expect(urgencyOf({ redFlags: ["severe_swelling"], trauma: "yes" })).toBe(
      "emergency",
    );
    expect(urgencyOf({ redFlags: ["severe_swelling"], trauma: "no" })).toBe(
      "soon",
    );
    expect(urgencyOf({ redFlags: [], trauma: "no" })).toBe("none");
  });
});

describe("медицинские советы", () => {
  it.each([
    "что выпить от боли в колене?",
    "какие таблетки принимать?",
    "можно ли пить ибупрофен",
    "чем лечить горло",
    "какая дозировка?",
    "что у меня за болезнь",
    "поставьте диагноз",
    "это опасно?",
    "посмотрите мои анализы",
  ])("запрос совета: «%s»", (text) => {
    expect(isMedicalAdviceRequest(text)).toBe(true);
  });

  it.each([
    "хочу записаться к ортопеду",
    "сколько стоит приём",
    "болит колено",
  ])("не запрос совета: «%s»", (text) => {
    expect(isMedicalAdviceRequest(text)).toBe(false);
  });

  it.each([
    "Примите ибупрофен 400 мг",
    "Скорее всего, у вас артрит, это ничего страшного.",
    "Приложите лёд на 15 минут",
    "Свободно завтра в 10:00",
    "Приём стоит 2300 ₽",
  ])("ответ модели отклоняется: «%s»", (text) => {
    expect(isUnsafeReply(text)).toBe(true);
  });

  it("обычный ответ администратора допустим", () => {
    expect(
      isUnsafeReply(
        "Понял вас. Могу предложить запись к травматологу-ортопеду для очной оценки.",
      ),
    ).toBe(false);
  });
});
