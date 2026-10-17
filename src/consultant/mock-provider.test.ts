import { describe, expect, it } from "vitest";
import { getAllSolutions, getIndustries, getSolutions } from "@/catalog";
import { formatDuration } from "@/catalog/links";
import { formatPackagePrice } from "@/catalog/price";
import {
  EXAMPLE_TASKS,
  MOCK_INDUSTRY_STEMS,
  MOCK_TOPICS,
  MockChatProvider,
} from "@/consultant/mock-provider";
import type { ChatTurn } from "@/consultant/types";

const provider = new MockChatProvider(getSolutions(), getIndustries());
const user = (...texts: string[]): ChatTurn[] =>
  texts.flatMap((text, i) =>
    i < texts.length - 1
      ? [
          { role: "user" as const, text },
          { role: "assistant" as const, text: "…" },
        ]
      : [{ role: "user" as const, text }],
  );
const ids = async (...texts: string[]) =>
  (await provider.reply(user(...texts))).recommendations.map(
    (r) => r.solutionId,
  );

describe("конфигурация mock", () => {
  it("ссылается только на существующие решения и отрасли", () => {
    const solutionIds = new Set(getSolutions().map((s) => s.id));
    const industryIds = new Set(getIndustries().map((i) => i.id));
    for (const topic of MOCK_TOPICS) {
      for (const id of topic.solutionIds)
        expect(solutionIds.has(id), id).toBe(true);
    }
    for (const id of Object.keys(MOCK_INDUSTRY_STEMS)) {
      expect(industryIds.has(id), id).toBe(true);
    }
  });

  it("каждый пример задачи приводит к рекомендации", async () => {
    for (const example of EXAMPLE_TASKS) {
      expect((await ids(example)).length, example).toBeGreaterThan(0);
    }
  });
});

describe("сценарии диалога", () => {
  it("звонки и запись → ИИ-администратор, с учётом отрасли", async () => {
    const r = await provider.reply(
      user("Клиника тратит много времени на звонки и запись пациентов"),
    );
    expect(r.recommendations[0].solutionId).toBe("clinic-ai-administrator");
    expect(r.recommendations[0].reason).toMatch(/отрасль есть в списке/);
    expect(r.text).toMatch(/Медицина и клиники/);
  });

  it("обращения в почте → маршрутизация обращений с пометкой концепции", async () => {
    const r = await provider.reply(
      user("Обращения пациентов теряются в общей почте"),
    );
    expect(r.recommendations[0].solutionId).toBe("patient-request-routing");
    expect(r.recommendations[0].reason).toMatch(/^статус: концепция/);
    expect(r.text).toContain("не готовые продукты");
  });

  it("документы пациента → концепция помощника с пометкой статуса", async () => {
    const r = await provider.reply(
      user("Хотим, чтобы пациенты загружали выписки и анкету до приёма"),
    );
    const rec = r.recommendations.find(
      (x) => x.solutionId === "patient-ai-assistant",
    );
    expect(rec?.reason).toMatch(/^статус: концепция/);
    expect(r.text).toContain("не готовые продукты");
  });

  it("приветствие → уточняющий вопрос и примеры, без рекомендаций", async () => {
    const r = await provider.reply(user("Привет"));
    expect(r.recommendations).toEqual([]);
    expect(r.text).toMatch(/^Здравствуйте!/);
    expect(r.followUps).toEqual(EXAMPLE_TASKS);
  });

  it("только отрасль → уточнение задачи клиники", async () => {
    const r = await provider.reply(user("Мы стоматологическая клиника"));
    expect(r.recommendations).toEqual([]);
    expect(r.text).toMatch(/задачу клиники/);
  });

  it("контекст накапливается: отрасль, затем задача", async () => {
    const r = await provider.reply(
      user(
        "Мы стоматологическая клиника",
        "Администраторы не успевают отвечать на сообщения",
      ),
    );
    expect(r.recommendations[0].solutionId).toBe("clinic-ai-administrator");
  });

  it("другая отрасль → честный ответ, что работаем только с клиниками", async () => {
    for (const text of [
      "Ресторан, принимаем заказы по телефону",
      "Нужно автоматизировать бухгалтерию",
      "Менеджеры по продажам тонут в сделках в CRM",
    ]) {
      const r = await provider.reply(user(text));
      expect(r.recommendations, text).toEqual([]);
      expect(r.text, text).toMatch(/только с частными медицинскими клиниками/);
    }
  });

  it("другая отрасль после задачи клиники — тоже честный ответ", async () => {
    const r = await provider.reply(
      user("Пациенты пишут ночью", "А ещё у нас ресторан, принимаем заказы"),
    );
    expect(r.recommendations).toEqual([]);
    expect(r.text).toMatch(/только с частными медицинскими клиниками/);
  });

  it("медицинский вопрос → без советов, диагнозов и рекомендаций решений", async () => {
    const r = await provider.reply(user("У меня болит горло, чем лечить?"));
    expect(r.recommendations).toEqual([]);
    expect(r.text).toMatch(/не даю медицинских советов/);
    expect(r.text).toMatch(/врачу/);
  });

  it("задача вне каталога → честный ответ без рекомендаций", async () => {
    const r = await provider.reply(
      user("Здравствуйте", "Нужен логотип и дизайн упаковки"),
    );
    expect(r.recommendations).toEqual([]);
    expect(r.text).toMatch(/Не нашёл в каталоге/);
  });

  it("основа не находится внутри других слов", async () => {
    // «контакт» содержит «акт», «работ» — «бот»
    expect(await ids("Хотим обновить контакты и улучшить работу")).toEqual([]);
  });

  it("вопрос о цене — тарифы из каталога с обслуживанием и пометкой", async () => {
    const r = await provider.reply(
      user("Пациенты пишут ночью, а ответить некому", "Сколько это стоит?"),
    );
    const solution = getSolutions().find(
      (s) => s.id === "clinic-ai-administrator",
    )!;
    for (const pkg of solution.packages) {
      expect(r.text).toContain(`«${pkg.title}» — ${formatPackagePrice(pkg)}`);
    }
    expect(r.text).toContain("/мес.");
    expect(r.text).toContain(solution.pricingNote!);
  });

  it("вопрос о сроках — сроки из каталога, без выдуманных", async () => {
    const r = await provider.reply(
      user("Пациенты пишут ночью", "Какие сроки?"),
    );
    const solution = getSolutions().find(
      (s) => s.id === "clinic-ai-administrator",
    )!;
    for (const pkg of solution.packages) {
      expect(r.text).toContain(
        pkg.duration
          ? `«${pkg.title}» — ориентировочно ${formatDuration(pkg.duration)}`
          : `«${pkg.title}» — срок определяется после обсуждения`,
      );
    }
  });

  it("вопрос о требованиях — данные, доступы и ограничения из каталога", async () => {
    const r = await provider.reply(
      user("Клиника, запись пациентов", "Что нужно от нас для внедрения?"),
    );
    const solution = getSolutions().find(
      (s) => s.id === "clinic-ai-administrator",
    )!;
    for (const line of [
      ...solution.dataRequirements,
      ...solution.limitations,
    ]) {
      expect(r.text).toContain(line);
    }
  });

  it("рекомендует только публичные решения", async () => {
    const pub = new Set(getSolutions().map((s) => s.id));
    for (const text of [
      "CRM документы клиника запись склад школа бухгалтерия ресторан",
      "что угодно",
      ...EXAMPLE_TASKS,
    ]) {
      for (const id of await ids(text)) expect(pub.has(id), id).toBe(true);
    }
  });

  it("скрытые решения не рекомендуются, даже если провайдер получил весь каталог", async () => {
    const full = new MockChatProvider(getAllSolutions(), getIndustries());
    const hidden = new Set(
      getAllSolutions()
        .filter((s) => s.hidden)
        .map((s) => s.id),
    );
    for (const text of ["счета и накладные", "бухгалтерия", "ресторан"]) {
      const r = await full.reply(user(text));
      for (const rec of r.recommendations) {
        expect(hidden.has(rec.solutionId), rec.solutionId).toBe(false);
      }
    }
  });

  it("концепции всегда помечены в причине", async () => {
    const byId = new Map(getSolutions().map((s) => [s.id, s]));
    for (const text of [
      ...EXAMPLE_TASKS,
      "запись на приём",
      "документы пациента и анкета",
    ]) {
      for (const rec of (await provider.reply(user(text))).recommendations) {
        if (byId.get(rec.solutionId)!.maturity !== "demo") {
          expect(rec.reason, rec.solutionId).toMatch(/^статус:/);
        }
      }
    }
  });
});
