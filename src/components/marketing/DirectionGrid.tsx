import Link from "next/link";
import { getSolutions } from "@/catalog";
import {
  catalogHref,
  EMPTY_QUERY,
  filterSolutions,
  pluralRu,
} from "@/catalog/search";
import { Icon } from "@/components/ui/Icon";
import type { Direction } from "@/content/directions";

/** Направления со ссылками в каталог и числом подходящих решений. */
export function DirectionGrid({ items }: { items: readonly Direction[] }) {
  const solutions = getSolutions();
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((direction) => {
        const query = { ...EMPTY_QUERY, ...direction.query };
        const count = filterSolutions(solutions, query).length;
        return (
          <li key={direction.id}>
            <Link
              href={catalogHref(query)}
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
                  {count} {pluralRu(count, ["решение", "решения", "решений"])} в
                  демо-каталоге
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
