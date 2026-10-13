import { describe, expect, it } from "vitest";
import { formatPrice, getPriceParts, getStartingPrice } from "@/catalog/price";
import type { Price } from "@/catalog/schema";

/** Intl может ставить обычный, неразрывный или узкий неразрывный пробел. */
const normalize = (s: string) => s.replace(/[  ]/g, " ");

const fixed = (amount: number): Price => ({
  kind: "fixed",
  amount,
  currency: "RUB",
});
const from = (amount: number): Price => ({
  kind: "from",
  amount,
  currency: "RUB",
});
const onRequest: Price = { kind: "on_request" };

const withPrices = (...prices: Price[]) => ({
  packages: prices.map((price, i) => ({
    id: `p${i}`,
    title: "Пакет",
    summary: "Пакет",
    price,
    includes: ["Работа"],
  })),
});

describe("formatPrice", () => {
  it("фиксированная цена — без «от»", () => {
    expect(normalize(formatPrice(fixed(15000000)))).toBe("150 000 ₽");
  });

  it("цена «от» сохраняет префикс", () => {
    expect(normalize(formatPrice(from(5000000)))).toBe("от 50 000 ₽");
  });

  it("цена по запросу", () => {
    expect(formatPrice(onRequest)).toBe("По запросу");
  });

  it("показывает копейки, если они есть", () => {
    expect(normalize(formatPrice(fixed(10050)))).toBe("100,5 ₽");
  });
});

describe("getStartingPrice", () => {
  it("не превращает «от» в фиксированную цену", () => {
    const result = getStartingPrice(withPrices(from(5000000), fixed(9000000)));
    expect(result).toEqual(from(5000000));
    expect(normalize(formatPrice(result))).toBe("от 50 000 ₽");
  });

  it("единственная цена «от» остаётся «от»", () => {
    expect(getStartingPrice(withPrices(from(1000)))).toEqual(from(1000));
  });

  it("фиксированная цена остаётся фиксированной", () => {
    expect(getStartingPrice(withPrices(fixed(1000), from(2000)))).toEqual(
      fixed(1000),
    );
  });

  it("при равных суммах выбирает «от», а не фиксированную", () => {
    expect(getStartingPrice(withPrices(fixed(1000), from(1000)))).toEqual(
      from(1000),
    );
    expect(getStartingPrice(withPrices(from(1000), fixed(1000)))).toEqual(
      from(1000),
    );
  });

  it("пропускает пакеты «по запросу»", () => {
    expect(
      getStartingPrice(withPrices(onRequest, from(3000), fixed(5000))),
    ).toEqual(from(3000));
  });

  it("если сумм нет — «по запросу»", () => {
    expect(getStartingPrice(withPrices(onRequest, onRequest))).toEqual(
      onRequest,
    );
  });

  it("возвращает цену пакета без изменений", () => {
    const price = from(4200);
    expect(getStartingPrice(withPrices(price))).toBe(price);
  });
});

describe("getPriceParts", () => {
  it("цена «от» отдаёт префикс отдельно от суммы", () => {
    const parts = getPriceParts(from(5000000));
    expect(parts.kind).toBe("from");
    if (parts.kind !== "from") return;
    expect(parts.prefix).toBe("от");
    expect(normalize(parts.amount)).toBe("50 000 ₽");
  });

  it("фиксированная цена — без префикса", () => {
    const parts = getPriceParts(fixed(15000000));
    expect(parts).not.toHaveProperty("prefix");
    expect(parts.kind).toBe("fixed");
  });

  it("цена по запросу — без суммы", () => {
    expect(getPriceParts(onRequest)).toEqual({
      kind: "on_request",
      label: "По запросу",
    });
  });
});
