import { getCategories, getSolutions, getStartingPrice } from "@/catalog";
import { DemoBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { PriceTag } from "@/components/ui/PriceTag";

/**
 * Декоративная «витрина» первого экрана: стопка стеклянных карточек
 * с реальными демо-данными каталога. Для скринридеров скрыта —
 * те же решения перечислены ниже в блоке «Решения из каталога».
 */
export function HeroShowcase() {
  const [front, middle, back] = getSolutions();
  const categoryTitle = new Map(getCategories().map((c) => [c.id, c.title]));

  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-md select-none"
    >
      <span className="pointer-events-none absolute -inset-10 rounded-full bg-[radial-gradient(closest-side,rgb(165_163_255/0.28),transparent)]" />

      {back && (
        <div className="glass rounded-card absolute inset-x-10 -top-10 h-40 rotate-[-4deg] opacity-60" />
      )}
      {middle && (
        <div className="glass rounded-card absolute inset-x-5 -top-5 p-5 opacity-80">
          <p className="text-small text-muted truncate">{middle.title}</p>
        </div>
      )}
      {front && (
        <div className="glass rounded-card relative p-6">
          <div className="flex flex-wrap gap-2">
            <DemoBadge />
            <span className="text-caption text-muted border-border rounded-full border px-2.5 py-0.5">
              {categoryTitle.get(front.categoryIds[0])}
            </span>
          </div>
          <p className="text-h3 mt-4 font-semibold">{front.title}</p>
          <p className="text-small text-muted mt-2 line-clamp-2">
            {front.summary}
          </p>
          <div className="border-border mt-5 flex items-center justify-between border-t pt-4">
            <PriceTag price={getStartingPrice(front)} size="lg" />
            <span className="liquid-primary grid size-9 place-items-center rounded-full">
              <Icon name="arrow-right" size={16} />
            </span>
          </div>
        </div>
      )}

      <div className="glass absolute -bottom-6 left-3 flex items-center gap-2 rounded-full px-4 py-2 sm:-left-10">
        <Icon name="sparkle" size={16} className="text-accent" />
        <span className="text-caption">Пакеты, сроки и ограничения</span>
      </div>
    </div>
  );
}
