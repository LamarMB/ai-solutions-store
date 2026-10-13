"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useOptimistic,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  catalogHref,
  isQueryEmpty,
  QUERY_PARAMS,
  toggleValue,
  type CatalogQuery,
} from "@/catalog/search";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

type Option = { id: string; title: string };

type CatalogControlsProps = {
  query: CatalogQuery;
  categories: readonly Option[];
  industries: readonly Option[];
};

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Поиск и фильтры каталога. Источник правды — URL: изменения записываются
 * через router.replace, страница перерисовывается на сервере.
 * Без JavaScript работает как обычная GET-форма.
 */
export function CatalogControls({
  query,
  categories,
  industries,
}: CatalogControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(query);
  const [text, setText] = useState(query.q);
  const [syncedQ, setSyncedQ] = useState(query.q);

  // URL изменился извне (назад/вперёд, сброс) — подтягиваем строку поиска.
  if (query.q !== syncedQ) {
    setSyncedQ(query.q);
    if (query.q !== text.trim()) setText(query.q);
  }

  const navigate = (next: CatalogQuery) => {
    startTransition(() => {
      setOptimistic(next);
      router.replace(catalogHref(next), { scroll: false });
    });
  };

  // Поиск по мере ввода — с задержкой; фильтры берём из актуального состояния.
  useEffect(() => {
    if (text.trim() === optimistic.q) return;
    const timer = setTimeout(
      () => navigate({ ...optimistic, q: text }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
    // navigate пересоздаётся на каждом рендере, но читает те же router и setOptimistic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, optimistic]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ ...optimistic, q: text });
  };

  const hasFilters = !isQueryEmpty(optimistic) || text.trim() !== "";

  return (
    <form
      action="/catalog"
      method="get"
      role="search"
      aria-label="Поиск и фильтры каталога"
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-5"
    >
      <div className="glass flex h-13 items-center gap-2 rounded-full pr-1.5 pl-5">
        <Icon name="search" className="text-muted shrink-0" />
        <label htmlFor="catalog-search" className="sr-only">
          Поиск по названию и описанию
        </label>
        <input
          id="catalog-search"
          name={QUERY_PARAMS.q}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Поиск решений"
          maxLength={100}
          autoComplete="off"
          enterKeyHint="search"
          className="text-body text-ink placeholder:text-muted h-full w-0 min-w-0 flex-1 bg-transparent outline-none"
        />
        <button
          type="submit"
          className="liquid-primary text-small inline-flex h-10 shrink-0 items-center rounded-full px-4 font-medium"
        >
          Найти
        </button>
      </div>

      <FilterGroup
        legend="Категории"
        name={QUERY_PARAMS.category}
        options={categories}
        selected={optimistic.categories}
        onToggle={(id) =>
          navigate({
            ...optimistic,
            q: text,
            categories: toggleValue(optimistic.categories, id),
          })
        }
      />
      <FilterGroup
        legend="Отрасли"
        name={QUERY_PARAMS.industry}
        options={industries}
        selected={optimistic.industries}
        onToggle={(id) =>
          navigate({
            ...optimistic,
            q: text,
            industries: toggleValue(optimistic.industries, id),
          })
        }
      />

      <div className="flex min-h-6 items-center gap-4">
        {hasFilters && (
          <Link
            href="/catalog"
            scroll={false}
            className="text-small text-accent hover:text-accent-hover inline-flex items-center gap-1.5 rounded-full font-medium"
          >
            <Icon name="close" size={16} />
            Сбросить фильтры
          </Link>
        )}
        <span
          aria-hidden="true"
          className={cn(
            "text-caption text-muted transition-opacity",
            isPending ? "opacity-100" : "opacity-0",
          )}
        >
          Обновляем…
        </span>
      </div>
    </form>
  );
}

function FilterGroup({
  legend,
  name,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  name: string;
  options: readonly Option[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-caption text-muted mb-2 font-semibold tracking-wide uppercase">
        {legend}
      </legend>
      {/* На мобильных — горизонтальная лента, на широких экранах — перенос строк. */}
      <div className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label
              key={option.id}
              className={cn(
                "text-small inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 whitespace-nowrap transition-colors duration-200 select-none",
                "has-focus-visible:outline-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
                checked
                  ? "border-accent/60 bg-accent-soft text-ink"
                  : "glass glass-hover text-muted hover:text-ink",
              )}
            >
              <input
                type="checkbox"
                name={name}
                value={option.id}
                checked={checked}
                onChange={() => onToggle(option.id)}
                className="sr-only"
              />
              {checked && <Icon name="check" size={16} />}
              {option.title}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
