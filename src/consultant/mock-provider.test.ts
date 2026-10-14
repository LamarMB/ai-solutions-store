import { describe, expect, it } from "vitest";
import { getIndustries, getSolutions } from "@/catalog";
import { formatDuration } from "@/catalog/links";
import { formatPrice } from "@/catalog/price";
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
  it("клиника и запись → ИИ-администратор, с учётом отрасли", async () => {
    const r = await provider.reply(
      user("Клиника тратит много времени на звонки и запись пациентов"),
    );
    expect(r.recommendations[0].solutionId).toBe("clinic-ai-administrator");
    expect(r.recommendations[0].reason).toMatch(/отрасль есть в списке/);
    expect(r.text).toMatch(/Медицина и клиники/);
  });

  it("счета и накладные → извлечение данных", async () => {
    expect(await ids("Долго вносим счета и накладные в 1С")).toEqual([
      "document-data-extraction",
    ]);
  });

  it("CRM и продажи → интеграция с CRM", async () => {
    expect((await ids("Менеджеры по продажам тонут в сделках в CRM"))[0]).toBe(
      "crm-ai-integration",
    );
  });

  it("несколько задач → несколько решений", async () => {
    expect(
      await ids("Нужна обработка документов и помощь отделу продаж"),
    ).toEqual(
      expect.arrayContaining([
        "document-data-extraction",
        "crm-ai-integration",
      ]),
    );
  });

  it("приветствие → уточняющий вопрос и примеры, без рекомендаций", async () => {
    const r = await provider.reply(user("Привет"));
    expect(r.recommendations).toEqual([]);
    expect(r.text).toMatch(/^Здравствуйте!/);
    expect(r.followUps).toEqual(EXAMPLE_TASKS);
  });

  it("только отрасль → уточнение задачи", async () => {
    const r = await provider.reply(user("У нас логистическая компания"));
    expect(r.recommendations).toEqual([]);
    expect(r.text).toMatch(/Логистика/);
    expect(r.followUps.length).toBeGreaterThan(0);
  });

  it("контекст накапливается: отрасль, затем задача", async () => {
    const r = await provider.reply(
      user(
        "Мы стоматологическая клиника",
        "Администраторы не успевают отвечать на обращения",
      ),
    );
    expect(r.recommendations[0].solutionId).toBe("clinic-ai-administrator");
  });

  it("новая задача в продолжении диалога выходит на первое место", async () => {
    const r = await provider.reply(
      user(
        "Клиника тратит много времени на звонки и запись пациентов",
        "Сколько это стоит?",
        "Склад и логистика, долго вносим накладные",
      ),
    );
    expect(r.recommendations[0].solutionId).toBe("document-data-extraction");
    expect(r.text).toMatch(/^Похоже, ваша задача — обработка документов/);
  });

  it("«долго» в описании задачи не считается вопросом о сроках", async () => {
    const r = await provider.reply(user("Долго вносим счета"));
    expect(r.text).not.toMatch(/^Сроки/);
    expect(r.recommendations[0].solutionId).toBe("document-data-extraction");
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

  it("вопрос о цене — цены из каталога без изменений", async () => {
    const r = await provider.reply(
      user("Нужно обрабатывать счета", "Сколько это стоит?"),
    );
    const solution = getSolutions().find(
      (s) => s.id === "document-data-extraction",
    )!;
    for (const pkg of solution.packages) {
      expect(r.text).toContain(`«${pkg.title}» — ${formatPrice(pkg.price)}`);
    }
    expect(r.recommendations[0].solutionId).toBe("document-data-extraction");
  });

  it("вопрос о сроках — сроки из каталога, без выдуманных", async () => {
    const r = await provider.reply(user("Интеграция с CRM", "Какие сроки?"));
    const solution = getSolutions().find((s) => s.id === "crm-ai-integration")!;
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

  it("рекомендует только существующие решения", async () => {
    const all = new Set(getSolutions().map((s) => s.id));
    for (const text of [
      "CRM документы клиника запись склад школа",
      "что угодно",
    ]) {
      for (const id of await ids(text)) expect(all.has(id)).toBe(true);
    }
  });

  it("бухгалтерия → AI Accounting Department со статусом «в разработке»", async () => {
    const r = await provider.reply(
      user("Нужно автоматизировать бухгалтерию и первичные документы"),
    );
    const aad = r.recommendations.find(
      (x) => x.solutionId === "ai-accounting-department",
    );
    expect(aad).toBeDefined();
    expect(aad!.reason).toContain("в разработке");
    expect(r.text).toContain("не готовые продукты");
  });

  it("ресторан и заказы → ассистент приёма заказов", async () => {
    expect((await ids("Ресторан, принимаем заказы по телефону"))[0]).toBe(
      "restaurant-order-assistant",
    );
  });

  it("концепции и продукты в разработке всегда помечены в причине", async () => {
    const byId = new Map(getSolutions().map((s) => [s.id, s]));
    for (const text of [
      ...EXAMPLE_TASKS,
      "подбор кандидатов",
      "поиск по базе знаний",
      "квалификация лидов",
      "сверка актов",
    ]) {
      for (const rec of (await provider.reply(user(text))).recommendations) {
        if (byId.get(rec.solutionId)!.maturity !== "demo") {
          expect(rec.reason, rec.solutionId).toMatch(/^статус:/);
        }
      }
    }
  });
});
