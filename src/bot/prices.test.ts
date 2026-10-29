import { describe, expect, it } from "vitest";
import { createBot } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import {
  clinicReference,
  pricesText,
  PRICES_TEXT_MAX,
} from "@/bot/clinic/knowledge";
import type { Clinic, Service } from "@/bot/clinic/types";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import type { Action, Reply } from "@/bot/dialog/types";
import { conversationInstructions } from "@/bot/llm/openai-conversation";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";
import { splitText } from "@/bot/vk/runner";

/**
 * Большой прайс (P0-3): сотни услуг. Бот показывает цены по направлениям и
 * страницам — каждое сообщение короче лимита ВКонтакте, кнопок не больше 10,
 * ни одна услуга не теряется. Цены и услуги вымышленные.
 */

const NOW = new Date("2026-10-19T06:00:00Z");
/** Лимит сообщения ВКонтакте и inline-клавиатуры. */
const VK_MESSAGE_MAX = 4096;
const VK_BUTTONS_MAX = 10;

function clinicWith(count: number, extraSpecialties = 0): Clinic {
  const specialties = [
    ...fictionalClinic.specialties,
    ...Array.from({ length: extraSpecialties }, (_, i) => ({
      id: `sp-extra${i}`,
      title: `Направление номер ${i + 1} с очень длинным названием для кнопки`,
      toWhom: "к специалисту",
    })),
  ];
  const services: Service[] = Array.from({ length: count }, (_, i) => ({
    title: `Исследование «Вариант ${i + 1}» с подробным названием услуги`,
    // Каждая 25-я — без специальности.
    specialtyId: i % 25 === 0 ? "" : specialties[i % specialties.length].id,
    priceRub: 500 + i * 10,
  }));
  return { ...fictionalClinic, specialties, services };
}

function setup(clinic: Clinic) {
  const store = new SqliteStore(":memory:");
  const bot = createBot({
    clinic,
    schedule: new ClinicSchedule(clinic, store, () => NOW),
    sessions: store,
    interpreter: new RuleInterpreter(clinic),
    demo: false,
    now: () => NOW,
  });
  const PEER = 123456111;
  const all: Reply[] = [];
  const send = async (event: Parameters<typeof bot.handle>[1]) => {
    const replies = await bot.handle(PEER, event);
    all.push(...replies);
    return replies;
  };
  return {
    say: (text: string) => send({ type: "text", text }),
    press: (payload: Action) => send({ type: "action", payload }),
    all,
  };
}

const buttons = (reply: Reply) => reply.buttons.flat();
const find = (reply: Reply, label: string) =>
  buttons(reply).find((b) => b.label === label)?.action;

describe("бот: большой прайс", () => {
  it("350 услуг: выбор направления → все страницы цен; каждая услуга ровно один раз", async () => {
    const clinic = clinicWith(350);
    expect(pricesText(clinic, false).length).toBeGreaterThan(
      PRICES_TEXT_MAX * 5,
    );
    const t = setup(clinic);
    await t.say("Начать");
    const [chooser] = (await t.say("сколько стоит приём?")).slice(-1);
    expect(chooser.text).toMatch(/^Цены: выберите направление\./);
    const groups = buttons(chooser).filter((b) => b.action.a === "pr");
    // Пять направлений и «Другие услуги».
    expect(groups.map((b) => b.label)).toEqual([
      ...fictionalClinic.specialties.map((s) => s.title),
      "Другие услуги",
    ]);

    const seen: string[] = [];
    for (const group of groups) {
      let [reply] = (await t.press(group.action)).slice(-1);
      for (let guard = 0; ; guard++) {
        expect(guard).toBeLessThan(50);
        expect(reply.text.startsWith(`Цены — ${group.label}`)).toBe(true);
        seen.push(...reply.text.split("\n").filter((l) => l.startsWith("• ")));
        const more = find(reply, "Ещё цены");
        if (!more) break;
        [reply] = (await t.press(more)).slice(-1);
      }
      expect(find(reply, "Другие направления")).toEqual({ a: "pr" });
      expect(find(reply, "В меню")).toEqual({ a: "menu" });
    }
    const expected = [
      ...clinic.services.map((s) => s.title),
      ...clinic.doctors
        .filter((d) => d.priceRub !== undefined)
        .map((d) => `Приём: ${d.name}`),
    ];
    expect(seen).toHaveLength(expected.length);
    for (const title of expected)
      expect(seen.filter((l) => l.startsWith(`• ${title} — `))).toHaveLength(1);

    // Ни одно сообщение не длиннее лимита, кнопок не больше 10.
    for (const reply of t.all) {
      expect(reply.text.length).toBeLessThanOrEqual(PRICES_TEXT_MAX);
      expect(buttons(reply).length).toBeLessThanOrEqual(VK_BUTTONS_MAX);
      for (const b of buttons(reply)) {
        expect(b.label.length).toBeLessThanOrEqual(40);
        expect(JSON.stringify(b.action).length).toBeLessThanOrEqual(255);
      }
    }
  });

  it("много направлений — выбор по страницам, подписи кнопок до 40 символов", async () => {
    const clinic = clinicWith(400, 12);
    const t = setup(clinic);
    let [reply] = await t.press({ a: "info", k: "prices" });
    const titles: string[] = [];
    for (let page = 0; page < 3; page++) {
      expect(buttons(reply).length).toBeLessThanOrEqual(VK_BUTTONS_MAX);
      titles.push(
        ...buttons(reply)
          .filter((b) => b.action.a === "pr" && "s" in b.action)
          .map((b) => b.label),
      );
      const more = find(reply, "Ещё направления");
      expect(more).toBeDefined();
      [reply] = await t.press(more!);
    }
    // 5 + 12 направлений и «Другие услуги» — на трёх страницах, затем по кругу.
    expect(titles).toHaveLength(18);
    expect(new Set(titles).size).toBe(18);
    expect(titles.every((l) => l.length <= 40)).toBe(true);
    expect(reply.text).toMatch(/Страница 1 из 3/);
  });

  it("короткий прайс — одним сообщением, как раньше", async () => {
    const t = setup(fictionalClinic);
    await t.say("Начать");
    const replies = await t.say("сколько стоит?");
    expect(replies).toHaveLength(1);
    const [reply] = replies;
    expect(reply.text.startsWith("Цены:\n• Приём терапевта — 2 000 ₽")).toBe(
      true,
    );
  });

  it("устаревшая кнопка направления и страницы — показывает выбор, без ошибки", async () => {
    const t = setup(clinicWith(350));
    const [reply] = await t.press({ a: "pr", s: "sp-removed", p: 3 });
    expect(reply.text).toMatch(/выберите направление/);
    const [last] = await t.press({ a: "pr", s: "therapist", p: 200 });
    expect(last.text).toMatch(/^Цены — Терапевт \((\d+) из \1\):/);
  });

  it("справка модели при 1000 услуг ограничена: названия без цен и «…и ещё N»", () => {
    const small = clinicReference(fictionalClinic, false);
    expect(small).toContain("Приём терапевта — 2 000 ₽");
    const reference = clinicReference(clinicWith(1000), false);
    expect(reference).toContain(
      "Услуги (цены программа покажет, когда пациент спросит о ценах):",
    );
    expect(reference).toMatch(
      /…и ещё \d+ услуг — точный список у администратора\./,
    );
    expect(reference).not.toMatch(/Вариант 1».* — 500 ₽/);
    expect(
      conversationInstructions(clinicWith(1000), false).length,
    ).toBeLessThan(
      conversationInstructions(fictionalClinic, false).length + 7000,
    );
  });
});

describe("VK: деление длинного текста", () => {
  it("части не длиннее лимита, по границе строки, без потерь", () => {
    const text = Array.from(
      { length: 400 },
      (_, i) => `• Услуга ${i} — ${i * 10} ₽`,
    ).join("\n");
    const parts = splitText(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(VK_MESSAGE_MAX);
      expect(part.startsWith("• ")).toBe(true);
    }
    expect(parts.join("\n")).toBe(text);
    // Строка без переводов — режется по лимиту.
    const flat = "а".repeat(9000);
    expect(splitText(flat).map((p) => p.length)).toEqual([4000, 4000, 1000]);
    expect(splitText("коротко")).toEqual(["коротко"]);
  });
});
