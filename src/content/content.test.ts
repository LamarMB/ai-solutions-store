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

  it("публичные цены — «по запросу», пока владелец не утвердил цены; концепции без пакетов", () => {
    const kinds = new Set(
      getSolutions().flatMap((s) => s.packages.map((p) => p.price.kind)),
    );
    expect([...kinds].sort()).toEqual(["on_request"]);
    // Вид «по запросу» по-прежнему встречается в скрытых записях.
    expect(
      catalog.solutions.some((s) =>
        s.packages.some((p) => p.price.kind === "on_request"),
      ),
    ).toBe(true);
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
  it("Старт и Оптимум; цены не опубликованы до утверждения — «по запросу»", () => {
    expect(
      admin.packages.map((p) => [p.title, p.price, p.monthlyPrice]),
    ).toEqual([
      ["Старт", { kind: "on_request" }, { kind: "on_request" }],
      ["Оптимум", { kind: "on_request" }, { kind: "on_request" }],
    ]);
    expect(getStartingPrice(admin)).toEqual({ kind: "on_request" });
  });

  it("рекомендуемый — только «Оптимум»; стоимость — на демонстрации", () => {
    expect(
      admin.packages.filter((p) => p.recommended).map((p) => p.id),
    ).toEqual(["optimum"]);
    expect(admin.pricingNote).toMatch(/на демонстрации/);
  });

  it("запись: сразу — по расписанию панели, МИС — отдельно; без обещаний мгновенности", () => {
    const start = admin.packages.find((p) => p.id === "start")!;
    expect(start.includes.join(" ")).toMatch(
      /подтверждается сразу по расписанию в панели клиники/,
    );
    expect(admin.description).toMatch(
      /расписание клиники ведётся в нашей панели, запись подтверждается сразу/,
    );
    expect(admin.limitations.join(" ")).toMatch(/МИС.*оценивается отдельно/);
    const texts = [
      admin.description,
      ...admin.capabilities,
      ...admin.packages.flatMap((p) => [p.summary, ...p.includes]),
    ].join(" ");
    expect(texts).not.toMatch(/мгновенн|собирает заявку/i);
  });

  it("о внешнем ИИ — прозрачно и без обещания полной анонимизации", () => {
    expect(admin.description).toMatch(/внешним ИИ-сервисом/);
    const limits = admin.limitations.join(" ");
    expect(limits).toMatch(/телефоны и адреса почты перед отправкой удаляются/);
    expect(limits).toMatch(/не полная анонимизация/);
    const all = [
      admin.description,
      ...admin.capabilities,
      ...admin.limitations,
    ].join(" ");
    expect(all).not.toMatch(/полностью анонимн|анонимизирует/i);
  });

  it("будущие функции не входят в тарифы как готовые", () => {
    const includes = admin.packages.flatMap((p) => p.includes).join(" ");
    expect(includes).not.toMatch(/чат на сайте|Второй канал|напоминани/i);
    expect(includes).toMatch(/МИС.*оценивается отдельно/);
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

  it("маршрутизация обращений — концепция без пакетов и цены", () => {
    const routing = getSolutionById("patient-request-routing")!;
    expect(routing.maturity).toBe("concept");
    expect(routing.packages).toEqual([]);
    expect(getStartingPrice(routing)).toEqual({ kind: "on_request" });
  });

  it("каналы: только ВКонтакте подключается первым, остальные не обещаются", () => {
    const admin = getSolutionById("clinic-ai-administrator")!;
    const includes = admin.packages.flatMap((p) => p.includes).join(" ");
    expect(includes).toMatch(/ВКонтакте/);
    expect(includes).not.toMatch(/Два канала связи|До трёх каналов связи/);
    expect(admin.limitations.join(" ")).toMatch(
      /сообщения сообщества ВКонтакте и приложение клиники во ВКонтакте; чат на сайте и другие каналы — в планах/,
    );
    expect(admin.limitations.join(" ")).toMatch(
      /тестовым расписанием и вымышленными/,
    );
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
    expect(notReady.length).toBe(11);
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
