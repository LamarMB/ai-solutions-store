import { getStartingPrice } from "@/catalog/price";
import type { Solution } from "@/catalog/schema";
import { pluralRu } from "@/catalog/search";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PriceTag } from "@/components/ui/PriceTag";

type SolutionCardProps = {
  solution: Solution;
  categoryTitles: ReadonlyMap<string, string>;
  industryTitles: ReadonlyMap<string, string>;
};

/** Карточка решения в каталоге. Страница решения появится на этапе 5. */
export function SolutionCard({
  solution,
  categoryTitles,
  industryTitles,
}: SolutionCardProps) {
  const titleId = `solution-${solution.id}`;
  const startingPrice = getStartingPrice(solution);
  const startingPackage = solution.packages.find(
    (p) => p.price === startingPrice,
  );
  const packagesCount = solution.packages.length;
  const packagesLabel = `${packagesCount} ${pluralRu(packagesCount, ["пакет", "пакета", "пакетов"])}`;
  const industries =
    solution.industryIds.length === 0
      ? "Для любой отрасли"
      : solution.industryIds.map((id) => industryTitles.get(id)).join(", ");

  return (
    <Card
      aria-labelledby={titleId}
      className="flex h-full flex-col"
      role="article"
    >
      <div className="flex flex-wrap gap-2">
        {solution.isDemo && <DemoBadge />}
        {solution.categoryIds.map((id) => (
          <Badge key={id}>{categoryTitles.get(id)}</Badge>
        ))}
      </div>

      <h2 id={titleId} className="text-h3 mt-4 font-semibold text-balance">
        {solution.title}
      </h2>
      <p className="text-small text-muted mt-2 line-clamp-3">
        {solution.summary}
      </p>

      <p className="text-caption text-muted mt-4 mb-5">
        <span className="text-ink font-medium">Отрасли:</span> {industries}
      </p>

      <div className="border-border mt-auto border-t pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <PriceTag price={startingPrice} size="lg" />
          <span className="text-caption text-muted">
            {startingPackage && packagesCount > 1
              ? `пакет «${startingPackage.title}» · ${packagesLabel}`
              : startingPackage
                ? `пакет «${startingPackage.title}»`
                : packagesLabel}
          </span>
        </div>
      </div>
    </Card>
  );
}
