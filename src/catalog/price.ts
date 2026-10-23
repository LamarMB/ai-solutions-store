import type { Currency, Price } from "@/catalog/schema";

const MINOR_UNITS_PER_MAJOR = 100;

const formatters = {
  RUB: new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }),
} as const;

/** Части цены для вёрстки: префикс «от» отделён от суммы, вид цены сохраняется. */
export type PriceParts =
  | { kind: "fixed"; amount: string }
  | { kind: "from"; prefix: "от"; amount: string }
  | { kind: "on_request"; label: "По запросу" };

export function getPriceParts(price: Price): PriceParts {
  switch (price.kind) {
    case "on_request":
      return { kind: "on_request", label: "По запросу" };
    case "from":
      return {
        kind: "from",
        prefix: "от",
        amount: formatAmount(price.amount, price.currency),
      };
    case "fixed":
      return {
        kind: "fixed",
        amount: formatAmount(price.amount, price.currency),
      };
  }
}

/** Форматирует цену с сохранением её вида: «150 000 ₽», «от 50 000 ₽», «По запросу». */
export function formatPrice(price: Price): string {
  const parts = getPriceParts(price);
  switch (parts.kind) {
    case "on_request":
      return parts.label;
    case "from":
      return `${parts.prefix} ${parts.amount}`;
    case "fixed":
      return parts.amount;
  }
}

function formatAmount(amount: number, currency: Currency) {
  return formatters[currency].format(amount / MINOR_UNITS_PER_MAJOR);
}

/**
 * Начальная цена решения — цена самого дешёвого пакета без изменений.
 * Вид цены сохраняется: «от» остаётся «от», фиксированная — фиксированной.
 * При равных суммах предпочитается «от», чтобы не выдавать нижнюю границу
 * за точную цену. Если ни у одного пакета нет суммы — «по запросу».
 */
export function getStartingPrice(solution: {
  packages: readonly { price: Price }[];
}): Price {
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

/** Цена пакета текстом: «15 000 ₽ + 3 900 ₽/мес.» или только разовая цена. */
export function formatPackagePrice(pkg: {
  price: Price;
  monthlyPrice?: Price;
}): string {
  const once = formatPrice(pkg.price);
  return pkg.monthlyPrice
    ? `${once} + ${formatPrice(pkg.monthlyPrice)}/мес.`
    : once;
}
