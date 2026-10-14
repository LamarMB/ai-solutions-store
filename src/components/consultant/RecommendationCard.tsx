import Link from "next/link";
import { requestHref, solutionHref } from "@/catalog/links";
import type { RecommendationView } from "@/consultant/recommendations";
import { DemoBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { PriceTag } from "@/components/ui/PriceTag";

/** Карточка рекомендации: все данные — из каталога. */
export function RecommendationCard({ rec }: { rec: RecommendationView }) {
  return (
    <article
      aria-label={rec.title}
      className="rounded-card border-border bg-surface border p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        {rec.isDemo && <DemoBadge />}
      </div>
      <h3 className="text-body mt-2 font-semibold">
        <Link
          href={solutionHref(rec.solutionId)}
          className="hover:text-accent rounded-sm transition-colors"
        >
          {rec.title}
        </Link>
      </h3>
      <p className="text-small text-muted mt-1">{rec.summary}</p>
      {rec.reason && (
        <p className="text-caption text-muted mt-2">
          <span className="text-ink font-medium">Почему: </span>
          {rec.reason}
        </p>
      )}

      <ul className="border-border mt-3 grid gap-1.5 border-t pt-3">
        {rec.packages.map((pkg) => (
          <li
            key={pkg.id}
            className="text-small flex flex-wrap items-baseline justify-between gap-x-3"
          >
            <span>Пакет «{pkg.title}»</span>
            <PriceTag price={pkg.price} />
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`${solutionHref(rec.solutionId)}#packages-title`}
          className="liquid-primary text-small rounded-control inline-flex h-9 items-center gap-1.5 px-4 font-medium"
        >
          Выбрать пакет
          <Icon name="arrow-right" size={16} />
        </Link>
        <Link
          href={requestHref(rec.solutionId)}
          className="glass glass-hover text-small rounded-control text-ink inline-flex h-9 items-center px-4 font-medium"
        >
          Оставить заявку
        </Link>
      </div>
    </article>
  );
}
