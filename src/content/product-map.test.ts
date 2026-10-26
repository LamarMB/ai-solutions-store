import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getSolutionById } from "@/catalog";
import { createDemoBot } from "@/bot";
import type { Button } from "@/bot/dialog/types";
import { MedicalCipher } from "@/bot/storage/medical-crypto";
import {
  AI_NOTE,
  PRODUCT_MAP_SOLUTION_ID,
  demoScreens,
  getScreen,
  mapNodes,
  overviewSteps,
  plannedFeatures,
  setupStages,
} from "@/content/product-map";
import {
  CHAT_NOW,
  demoChats,
  type ChatLine,
} from "@/content/product-map-chats";

const nodeIds = new Set<string>(mapNodes.map((n) => n.id));
const stageIds = new Set<string>(setupStages.map((s) => s.id));

describe("карта продукта: структура", () => {
  it("десять узлов, девять этапов, пять шагов на главной", () => {
    expect(mapNodes).toHaveLength(10);
    expect(setupStages).toHaveLength(9);
    expect(overviewSteps.map((s) => s.title)).toEqual([
      "Пациент обращается",
      "ИИ помогает",
      "Запись на приём",
      "Клиника управляет",
      "Персонал работает",
    ]);
  });

  it("id уникальны, связи и ссылки ведут на существующие узлы и этапы", () => {
    expect(nodeIds.size).toBe(mapNodes.length);
    expect(stageIds.size).toBe(setupStages.length);
    for (const n of mapNodes) {
      for (const id of n.next)
        expect(nodeIds.has(id), `${n.id}→${id}`).toBe(true);
      for (const id of n.stageIds) expect(stageIds.has(id), n.id).toBe(true);
    }
    for (const s of setupStages)
      for (const id of s.nodeIds) expect(nodeIds.has(id), s.id).toBe(true);
    for (const s of overviewSteps)
      for (const id of s.nodeIds) expect(nodeIds.has(id), s.id).toBe(true);
  });

  it("узлы не накладываются на схеме", () => {
    const cells = mapNodes.map((n) => `${n.col}:${n.lane}`);
    expect(new Set(cells).size).toBe(cells.length);
    for (const n of mapNodes) {
      expect(n.col).toBeGreaterThanOrEqual(1);
      expect(n.col).toBeLessThanOrEqual(5);
    }
  });

  it("каждый узел этапа настройки ссылается на этап, где это настраивается", () => {
    for (const n of mapNodes) {
      if ("setup" in n && n.setup)
        expect(n.stageIds.length, n.id).toBeGreaterThan(0);
    }
  });

  it("решение с картой существует и публично", () => {
    expect(getSolutionById(PRODUCT_MAP_SOLUTION_ID)).toBeDefined();
  });
});

describe("карта продукта: экраны демо", () => {
  it("все экраны узлов и шагов существуют", () => {
    for (const n of mapNodes)
      for (const id of n.screenIds)
        expect(getScreen(id), `${n.id}: ${id}`).toBeDefined();
    for (const s of overviewSteps)
      expect(getScreen(s.screenId), s.id).toBeDefined();
  });

  it("снимки лежат в public/demo и подписаны", () => {
    for (const s of demoScreens) {
      if (s.kind === "chat") continue;
      expect(existsSync(join(process.cwd(), "public", s.src)), s.src).toBe(
        true,
      );
      expect(s.alt.length, s.id).toBeGreaterThan(10);
    }
  });

  it("каждый экран используется", () => {
    const used = new Set<string>([
      ...mapNodes.flatMap((n) => n.screenIds),
      ...overviewSteps.map((s) => s.screenId),
    ]);
    for (const s of demoScreens) expect(used.has(s.id), s.id).toBe(true);
  });
});

describe("карта продукта: честность текстов", () => {
  const texts = [
    ...mapNodes.flatMap((n) => [
      n.title,
      n.summary,
      n.text,
      ...n.points,
      ...("setup" in n && n.setup ? [n.setup] : []),
    ]),
    ...setupStages.flatMap((s) => [
      s.title,
      s.text,
      s.outcome,
      ...s.activities,
      ...s.fromClinic,
    ]),
    ...overviewSteps.flatMap((s) => [s.title, s.text]),
    ...plannedFeatures.flatMap((f) => [f.title, f.text]),
  ];

  it("без выдуманных цифр, процентов, гарантий и обещаний результата", () => {
    for (const text of texts) {
      // Номера экстренных служб — единственные числа в текстах карты.
      expect(text.replace(/\b(103|112)\b/g, ""), text).not.toMatch(
        /\d|%|гарант|клиент[ао]в? довол|рост|экономи[яи]|мгновенн|круглосуточн|24\/7/i,
      );
    }
  });

  it("запись — сразу по расписанию панели, МИС — отдельно", () => {
    const booking = mapNodes.find((n) => n.id === "a5")!;
    expect(booking.text).toMatch(
      /расписанию в панели клиники запись подтверждается сразу/,
    );
    expect(booking.points.join(" ")).toMatch(/МИС.*оценивается отдельно/);
    const all = texts.join(" ");
    expect(all).not.toMatch(
      /собирает заявку|запись подтверждает администратор/,
    );
  });

  it("о внешнем ИИ — прозрачно, без обещания полной анонимизации", () => {
    expect(AI_NOTE).toMatch(/внешним ИИ-сервисом/);
    expect(AI_NOTE).toMatch(/телефоны и почта перед отправкой удаляются/);
    expect(AI_NOTE).toMatch(/не полная анонимизация/);
    const ai = mapNodes.find((n) => n.id === "a3")!;
    expect(ai.points.join(" ")).toMatch(/внешним ИИ-сервисом/);
    expect(texts.join(" ")).not.toMatch(/полностью анонимн|анонимизирует/i);
  });

  it("будущие функции — только в списке «В планах», не в узлах и шагах", () => {
    const working = [
      ...mapNodes.flatMap((n) => [n.title, n.summary, n.text]),
      ...overviewSteps.flatMap((s) => [s.title, s.text]),
    ].join(" ");
    expect(working).not.toMatch(
      /напоминани|чат на сайте|анкет|документы перед/i,
    );
    expect(plannedFeatures.map((f) => f.id)).toEqual(
      expect.arrayContaining(["reminders", "channels", "mis", "documents"]),
    );
  });

  it("без медицинских обещаний: не диагностика, не лечение", () => {
    const all = texts.join(" ");
    expect(all).not.toMatch(
      /постав(ит|им) диагноз|назнач(ит|им) лечение|вылеч/i,
    );
  });
});

describe("карта продукта: реплики бота совпадают с демо-ботом", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** Повторяет переписку на свежей базе: кнопки — по подписи, текст — как есть. */
  async function replay(lines: readonly ChatLine[]): Promise<ChatLine[]> {
    const dir = mkdtempSync(join(tmpdir(), "product-map-"));
    dirs.push(dir);
    const { bot, store } = createDemoBot({
      dbPath: join(dir, "bot.sqlite"),
      now: () => new Date(CHAT_NOW),
      cipher: MedicalCipher.fromBase64(MedicalCipher.generateKey()),
      miniApp: true,
    });
    const out: ChatLine[] = [];
    let buttons: Button[] = [];
    const push = (replies: Awaited<ReturnType<typeof bot.handle>>) => {
      for (const r of replies) {
        buttons = r.buttons.flat();
        out.push({
          from: "bot",
          text: r.text,
          ...(buttons.length > 0
            ? { buttons: buttons.map((b) => b.label) }
            : {}),
        });
      }
    };
    try {
      for (const line of lines) {
        if (line.from !== "patient") continue;
        out.push(line);
        const button = line.button
          ? buttons.find((b) => b.label === line.text)
          : undefined;
        if (line.button && !button)
          throw new Error(`нет кнопки «${line.text}»`);
        push(
          await bot.handle(
            1,
            button
              ? { type: "action", payload: button.action }
              : { type: "text", text: line.text },
          ),
        );
      }
    } finally {
      store.close();
    }
    return out;
  }

  it.each(Object.entries(demoChats))("%s", async (_, lines) => {
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].from).toBe("patient");
    expect(await replay(lines)).toEqual(lines);
  });
});
