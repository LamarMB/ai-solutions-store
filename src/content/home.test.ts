import { describe, expect, it } from "vitest";
import {
  benefits,
  demoSection,
  faq,
  hero,
  staffFeatures,
} from "@/content/home";
import { getScreen } from "@/content/product-map";

const texts = [
  hero.eyebrow,
  hero.title,
  hero.accent,
  hero.lead,
  hero.note,
  ...hero.channels.map((c) => c.label),
  ...benefits.flatMap((b) => [b.title, b.text]),
  ...staffFeatures.flatMap((f) => [f.title, f.text]),
  ...faq.flatMap((f) => [f.question, f.answer]),
  demoSection.title,
  demoSection.text,
  demoSection.pending,
  ...demoSection.points,
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
