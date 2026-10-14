import { describe, expect, it, vi } from "vitest";
import { getSolutions } from "@/catalog";
import { getStartingPrice } from "@/catalog/price";
import { redactContacts } from "@/consultant/privacy";
import { resolveRecommendations } from "@/consultant/recommendations";
import {
  handleConsultantMessage,
  type ConsultantDeps,
} from "@/consultant/service";
import type { ChatProvider, ChatTurn, ProviderReply } from "@/consultant/types";
import { createRateLimiter } from "@/requests/rate-limit";

const solutions = getSolutions();

function providerReturning(reply: Partial<ProviderReply> | Error) {
  const fn = vi.fn(async (turns: readonly ChatTurn[]) => {
    void turns;
    if (reply instanceof Error) throw reply;
    return { text: "ok", recommendations: [], followUps: [], ...reply };
  });
  const provider: ChatProvider = {
    info: { id: "test", kind: "mock", label: "test" },
    reply: fn,
  };
  return { provider, fn };
}

const deps = (provider: ChatProvider, limit = 100): ConsultantDeps => ({
  provider,
  solutions,
  limiter: createRateLimiter({ limit, windowMs: 60_000 }),
  clientKey: "k",
});

const history = (text = "Нужно обрабатывать счета") => [{ role: "user", text }];

describe("redactContacts", () => {
  it.each([
    ["пишите на ivan.petrov@mail.ru", "пишите на [email скрыт]"],
    ["тел. +7 (912) 345-67-89", "тел. [телефон скрыт]"],
    ["8 912 345 67 89 после обеда", "[телефон скрыт] после обеда"],
  ])("скрывает: %s", (input, output) => {
    expect(redactContacts(input)).toEqual({ text: output, redacted: true });
  });

  it.each([
    "внедрение за 3–5 недель",
    "в 2026 году",
    "100 000 ₽ бюджет",
    "1С 8.3",
  ])("не трогает обычные числа: %s", (input) => {
    expect(redactContacts(input)).toEqual({ text: input, redacted: false });
  });
});

describe("resolveRecommendations", () => {
  it("отбрасывает выдуманные решения и повторы, берёт данные из каталога", () => {
    const views = resolveRecommendations(
      [
        { solutionId: "made-up-solution", reason: "x" },
        { solutionId: "crm-ai-integration", reason: "подходит" },
        { solutionId: "crm-ai-integration", reason: "повтор" },
      ],
      solutions,
    );
    expect(views.map((v) => v.solutionId)).toEqual(["crm-ai-integration"]);
    const crm = solutions.find((s) => s.id === "crm-ai-integration")!;
    expect(views[0].title).toBe(crm.title);
    expect(views[0].startingPrice).toEqual(getStartingPrice(crm));
    expect(views[0].packages).toEqual(
      crm.packages.map((p) => ({ id: p.id, title: p.title, price: p.price })),
    );
  });

  it("не больше трёх рекомендаций", () => {
    const recs = [...solutions, ...solutions].map((s) => ({
      solutionId: s.id,
      reason: "",
    }));
    expect(resolveRecommendations(recs, solutions).length).toBeLessThanOrEqual(
      3,
    );
  });
});

describe("handleConsultantMessage", () => {
  it.each([
    ["пустая история", []],
    [
      "последнее сообщение не от пользователя",
      [{ role: "assistant", text: "привет" }],
    ],
    ["слишком длинное сообщение", history("а".repeat(1001))],
    ["лишние поля", [{ role: "user", text: "x", secret: 1 }]],
    [
      "слишком много сообщений",
      Array.from({ length: 31 }, () => ({ role: "user", text: "x" })),
    ],
    ["не массив", "hello"],
  ])("отклоняет: %s", async (_, input) => {
    const { provider, fn } = providerReturning({});
    const r = await handleConsultantMessage(input, deps(provider));
    expect(r.status).toBe("invalid");
    expect(fn).not.toHaveBeenCalled();
  });

  it("выдуманное провайдером решение не попадает в ответ", async () => {
    const { provider } = providerReturning({
      recommendations: [
        { solutionId: "fake", reason: "x" },
        { solutionId: "document-data-extraction", reason: "y" },
      ],
    });
    const r = await handleConsultantMessage(history(), deps(provider));
    expect(
      r.status === "ok" && r.recommendations.map((x) => x.solutionId),
    ).toEqual(["document-data-extraction"]);
  });

  it("контакты скрываются до передачи провайдеру", async () => {
    const { provider, fn } = providerReturning({});
    const r = await handleConsultantMessage(
      history("Клиника, звоните +7 912 345-67-89, почта a@b.ru"),
      deps(provider),
    );
    const passed = fn.mock.calls[0][0].map((t) => t.text).join(" ");
    expect(passed).not.toMatch(/912|a@b\.ru/);
    expect(r.status === "ok" && r.redacted).toBe(true);
  });

  it("ошибка провайдера → понятная ошибка с возможностью повтора", async () => {
    const { provider } = providerReturning(new Error("boom: secret details"));
    const r = await handleConsultantMessage(history(), deps(provider));
    expect(r).toEqual({
      status: "error",
      message: "Консультант сейчас не отвечает. Попробуйте ещё раз.",
    });
  });

  it("ограничение частоты", async () => {
    const { provider } = providerReturning({});
    const d = deps(provider, 2);
    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await handleConsultantMessage(history(), d)).status);
    expect(statuses).toEqual(["ok", "ok", "rate_limited"]);
  });

  it("быстрые ответы очищаются и ограничиваются", async () => {
    const { provider } = providerReturning({
      followUps: ["  да ", "", "x".repeat(200), "a", "b", "c", "d"],
    });
    const r = await handleConsultantMessage(history(), deps(provider));
    expect(r.status === "ok" && r.followUps).toEqual(["да", "a", "b", "c"]);
  });

  it("переписка не логируется", async () => {
    const spy = vi.spyOn(console, "log");
    const info = vi.spyOn(console, "info");
    const { provider } = providerReturning({});
    await handleConsultantMessage(history("секретная задача"), deps(provider));
    expect(
      [...spy.mock.calls, ...info.mock.calls].flat().join(" "),
    ).not.toContain("секретная");
    spy.mockRestore();
    info.mockRestore();
  });
});
