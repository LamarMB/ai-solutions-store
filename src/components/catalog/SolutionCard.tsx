import Link from "next/link";
import { solutionHref } from "@/catalog/links";
import { getStartingPrice } from "@/catalog/price";
import type { Solution } from "@/catalog/schema";
import { pluralRu } from "@/catalog/search";
import { Badge, DemoBadge, MaturityBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { PriceTag } from "@/components/ui/PriceTag";

type SolutionCardProps = {
  solution: Solution;
  categoryTitles: ReadonlyMap<string, string>;
  industryTitles: ReadonlyMap<string, string>;
  /** Уровень заголовка карточки: h2 в каталоге, h3 внутри секций. */
  headingLevel?: "h2" | "h3";
};

/** Карточка решения в каталоге; вся карточка ведёт на страницу решения. */
export function SolutionCard({
  solution,
  categoryTitles,
  industryTitles,
  headingLevel: Heading = "h2",
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
      interactive
      className="has-focus-visible:outline-accent relative flex h-full flex-col has-focus-visible:outline-2 has-focus-visible:outline-offset-2"
      role="article"
    >
      <div className="flex flex-wrap gap-2">
        {solution.isDemo && <DemoBadge />}
        <MaturityBadge maturity={solution.maturity} />
        {solution.categoryIds.map((id) => (
          <Badge key={id}>{categoryTitles.get(id)}</Badge>
        ))}
      </div>

      <Heading id={titleId} className="text-h3 mt-4 font-semibold text-balance">
        {/* Ссылка растянута на всю карточку (::after), фокус показывает карточка. */}
        <Link
          href={solutionHref(solution.id)}
          className="after:rounded-card outline-none after:absolute after:inset-0"
        >
          {solution.title}
        </Link>
      </Heading>
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
            {packagesCount === 0
              ? "пакеты не сформированы"
              : startingPackage && packagesCount > 1
                ? `пакет «${startingPackage.title}» · ${packagesLabel}`
                : startingPackage
                  ? `пакет «${startingPackage.title}»`
                  : packagesLabel}
          </span>
        </div>
        <p
          aria-hidden="true"
          className="text-small text-accent mt-4 inline-flex items-center gap-1.5 font-medium"
        >
          Подробнее
          <Icon name="arrow-right" size={16} />
        </p>
      </div>
    </Card>
  );
}
