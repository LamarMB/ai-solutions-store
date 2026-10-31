import { describe, expect, it } from "vitest";
import {
  benefits,
  demoSection,
  faq,
  hero,
  staffFeatures,
  workflow,
  type WorkflowNode,
} from "@/content/home";
import { getScreen } from "@/content/product-map";

const texts = [
  hero.eyebrow,
  hero.title,
  hero.accent,
  hero.highlight,
  hero.lead,
  hero.visualNote,
  ...hero.features.flatMap((f) => [f.title, f.text]),
  ...hero.channels.map((c) => c.label),
  ...hero.badges,
  ...benefits.flatMap((b) => [b.title, b.text]),
  ...staffFeatures.flatMap((f) => [f.title, f.text]),
  ...faq.flatMap((f) => [f.question, f.answer]),
  demoSection.title,
  demoSection.text,
  demoSection.pending,
  demoSection.contactNote,
  demoSection.contactNoteLive,
  ...demoSection.points,
  workflow.title,
  workflow.text,
  workflow.note,
  ...(workflow.nodes as readonly WorkflowNode[]).flatMap((n) => [
    n.title,
    n.text,
    ...n.details,
    ...(n.note ? [n.note] : []),
  ]),
];

describe("тексты главной", () => {
  it("без цифр (кроме 103 и 112), процентов и обещаний результата", () => {
    for (const text of texts) {
      expect(text.replace(/\b(103|112)\b/g, ""), text).not.toMatch(
        /\d|%|гарант|клиент[ао]в? довол|рост|экономи[яи]|отзыв|кейс/i,
      );
    }
  });

  it("будущие каналы — только с пометкой «в планах»", () => {
    for (const text of texts) {
      if (/чат на сайте|другие каналы/i.test(text)) {
        expect(text, text).toMatch(/в планах/i);
      }
    }
  });

  it("раздел демонстрации прямо говорит, что заявки через сайт не принимаются", () => {
    expect(demoSection.pending).toMatch(
      /заявки через сайт сейчас не принимаются/i,
    );
    expect(demoSection.contactNote).toMatch(/telegram/i);
    expect(demoSection.contactNote).toMatch(/тестовом режиме/i);
  });

  it("схема работы: пять блоков по порядку, без обещаний интеграций", () => {
    expect(workflow.nodes.map((n) => n.title)).toEqual([
      "Пациент",
      "ИИ-администратор",
      "Подбор врача и услуги",
      "Запись",
      "Информация для клиники",
    ]);
    const all = texts.join(" ");
    expect(all).not.toMatch(/n8n|webhook|вебхук|amoCRM|Битрикс/i);
    // МИС упоминается только как оцениваемая отдельно.
    for (const n of workflow.nodes)
      for (const d of n.details)
        if (/МИС/.test(d)) expect(d).toMatch(/оценивается отдельно/);
  });

  it("снимки панели существуют и это окна браузера", () => {
    for (const f of staffFeatures) {
      expect(getScreen(f.screenId)?.kind, f.screenId).toBe("browser");
    }
  });

  it("id частых вопросов уникальны", () => {
    const ids = faq.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
