import { getPriceParts } from "@/catalog/price";
import type { Price } from "@/catalog/schema";
import { cn } from "@/lib/cn";

type PriceTagProps = {
  price: Price;
  size?: "md" | "lg";
  className?: string;
};

/** Цена с сохранением вида: «от» визуально отделено, «по запросу» — без суммы. */
export function PriceTag({ price, size = "md", className }: PriceTagProps) {
  const parts = getPriceParts(price);
  const amountSize = size === "lg" ? "text-h3" : "text-body";

  if (parts.kind === "on_request") {
    return (
      <span className={cn("text-muted font-medium", amountSize, className)}>
        {parts.label}
      </span>
    );
  }

  return (
    <span className={cn("text-ink font-semibold tabular-nums", className)}>
      {/* Обычные inline-элементы с пробелом: текст копируется и читается
          как «от 50 000 ₽», а не двумя отдельными строками. */}
      {parts.kind === "from" && (
        <>
          <span className="text-small text-muted font-medium">
            {parts.prefix}
          </span>{" "}
        </>
      )}
      <span className={amountSize}>{parts.amount}</span>
    </span>
  );
}
