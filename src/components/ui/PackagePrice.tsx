import type { Package } from "@/catalog/schema";
import { PriceTag } from "@/components/ui/PriceTag";
import { cn } from "@/lib/cn";

/**
 * Цена пакета. Если есть ежемесячное обслуживание, показываются обе суммы с
 * подписями: разовая — «внедрение», ежемесячная — «в месяц, обслуживание».
 * `compact` — одной строкой для узких карточек: «15 000 ₽ + 3 900 ₽/мес.».
 */
export function PackagePrice({
  pkg,
  size = "md",
  compact = false,
  className,
}: {
  pkg: Pick<Package, "price" | "monthlyPrice">;
  size?: "md" | "lg";
  compact?: boolean;
  className?: string;
}) {
  if (!pkg.monthlyPrice) {
    return <PriceTag price={pkg.price} size={size} className={className} />;
  }
  if (compact) {
    return (
      <span className={className}>
        <PriceTag price={pkg.price} size={size} />
        <span className="text-small text-muted"> + </span>
        <PriceTag price={pkg.monthlyPrice} />
        <span className="text-small text-muted">/мес.</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-grid gap-1", className)}>
      <span>
        <PriceTag price={pkg.price} size={size} />{" "}
        <span className="text-caption text-muted">внедрение</span>
      </span>
      <span>
        <PriceTag price={pkg.monthlyPrice} />{" "}
        <span className="text-caption text-muted">в месяц, обслуживание</span>
      </span>
    </span>
  );
}
