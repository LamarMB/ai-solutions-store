import type { Price, Solution } from "@/catalog/schema";

const MINOR_UNITS_PER_MAJOR = 100;

const formatters = {
  RUB: new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }),
} as const;

/** Форматирует цену с сохранением её вида: «150 000 ₽», «от 50 000 ₽», «По запросу». */
export function formatPrice(price: Price): string {
  if (price.kind === "on_request") {
    return "По запросу";
  }
  const amount = formatters[price.currency].format(
    price.amount / MINOR_UNITS_PER_MAJOR,
  );
  return price.kind === "from" ? `от ${amount}` : amount;
}

/**
 * Начальная цена решения — цена самого дешёвого пакета без изменений.
 * Вид цены сохраняется: «от» остаётся «от», фиксированная — фиксированной.
 * При равных суммах предпочитается «от», чтобы не выдавать нижнюю границу
 * за точную цену. Если ни у одного пакета нет суммы — «по запросу».
 */
export function getStartingPrice(solution: Pick<Solution, "packages">): Price {
  let best: Exclude<Price, { kind: "on_request" }> | undefined;
  for (const { price } of solution.packages) {
    if (price.kind === "on_request") continue;
    if (best && price.currency !== best.currency) {
      throw new Error("Нельзя сравнивать цены пакетов в разных валютах");
    }
    if (
      !best ||
      price.amount < best.amount ||
      (price.amount === best.amount &&
        price.kind === "from" &&
        best.kind === "fixed")
    ) {
      best = price;
    }
  }
  return best ?? { kind: "on_request" };
}
