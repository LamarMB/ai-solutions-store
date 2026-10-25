import Link from "next/link";
import { getSolutionById } from "@/catalog";
import { solutionHref } from "@/catalog/links";
import { MATURITY_LABELS } from "@/catalog/maturity";
import { Icon } from "@/components/ui/Icon";
import type { Direction } from "@/content/directions";

/** Задачи клиники со ссылками на решения каталога и их статусом. */
export function DirectionGrid({ items }: { items: readonly Direction[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((direction) => {
        const solution = getSolutionById(direction.solutionId);
        if (!solution) return null;
        const status = MATURITY_LABELS[solution.maturity];
        return (
          <li key={direction.id}>
            <Link
              href={solutionHref(solution.id)}
              className="glass glass-hover group rounded-card flex h-full items-start gap-4 p-5"
            >
              <span className="liquid-primary grid size-11 shrink-0 place-items-center rounded-full">
                <Icon name={direction.icon} size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-body flex items-center justify-between gap-2 font-semibold">
                  {direction.title}
                  <Icon
                    name="arrow-right"
                    size={18}
                    className="text-muted group-hover:text-ink shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </span>
                <span className="text-small text-muted mt-1 block">
                  {direction.description}
                </span>
                <span className="text-caption text-muted mt-3 block">
                  {solution.title}
                  {status && ` · ${status.toLowerCase()}`}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
