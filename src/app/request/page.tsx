import type { Metadata } from "next";
import Link from "next/link";
import { getSolutions } from "@/catalog";
import { resolveRequestSelection, solutionHref } from "@/catalog/links";
import { ComingSoon } from "@/components/ComingSoon";
import { DemoBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PriceTag } from "@/components/ui/PriceTag";

export const metadata: Metadata = { title: "Оставить заявку" };

/**
 * Заглушка до этапа 7: показывает выбор, переданный через URL
 * (?solution=…&package=…). Форма и сбор данных здесь не реализуются.
 */
export default async function RequestPage({
  searchParams,
}: PageProps<"/request">) {
  const selection = resolveRequestSelection(await searchParams, getSolutions());

  return (
    <ComingSoon
      title="Оставить заявку"
      text="Форма заявки на выбранное решение появится на одном из следующих этапов."
    >
      {selection && (
        <Card className="mt-8" aria-label="Выбранное решение">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-caption text-muted font-semibold tracking-wide uppercase">
              Ваш выбор
            </p>
            {selection.solution.isDemo && <DemoBadge />}
          </div>
          <p className="text-h3 mt-3 font-semibold">
            <Link
              href={solutionHref(selection.solution.id)}
              className="hover:text-accent rounded-sm transition-colors"
            >
              {selection.solution.title}
            </Link>
          </p>
          {selection.package ? (
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-small">Пакет «{selection.package.title}»</p>
              <PriceTag price={selection.package.price} />
            </div>
          ) : (
            <p className="text-small text-muted mt-3">Пакет не выбран</p>
          )}
        </Card>
      )}
    </ComingSoon>
  );
}
