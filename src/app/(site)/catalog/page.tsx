import type { Metadata } from "next";
import { getCategories, getIndustries, getSolutions } from "@/catalog";
import {
  filterSolutions,
  isQueryEmpty,
  parseCatalogQuery,
  pluralRu,
} from "@/catalog/search";
import { CatalogControls } from "@/components/catalog/CatalogControls";
import { SolutionCard } from "@/components/catalog/SolutionCard";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";
import { pageMetadata } from "@/lib/seo";

// Фильтры и поиск — представления одной страницы: canonical всегда /catalog.
export const metadata: Metadata = pageMetadata({
  title: "ИИ-решения для медицинских клиник",
  description:
    "ИИ-администратор клиники, маршрутизация обращений пациентов и планируемый ИИ-помощник пациента: возможности, тарифы, ограничения и требования к данным.",
  path: "/catalog",
});

export default async function CatalogPage({
  searchParams,
}: PageProps<"/catalog">) {
  const categories = getCategories();
  const industries = getIndustries();
  const query = parseCatalogQuery(await searchParams, {
    categoryIds: categories.map((c) => c.id),
    industryIds: industries.map((i) => i.id),
  });
  const all = getSolutions();
  const results = filterSolutions(all, query);

  const categoryTitles = new Map(categories.map((c) => [c.id, c.title]));
  const industryTitles = new Map(industries.map((i) => [i.id, i.title]));
  const found = `${results.length} ${pluralRu(results.length, ["решение", "решения", "решений"])}`;

  return (
    <Section className="pt-10 md:pt-14 xl:pt-16">
      <header className="max-w-prose">
        <h1 className="text-h1 font-semibold">Каталог решений</h1>
        <p className="text-muted mt-3">
          ИИ для частных медицинских клиник: общение с пациентами, запись на
          приём и обработка обращений. Цены — предварительные.
        </p>
      </header>

      <div className="mt-8">
        <CatalogControls
          query={query}
          categories={categories}
          industries={industries}
        />
      </div>

      <p
        className="text-small text-muted mt-4"
        aria-live="polite"
        aria-atomic="true"
      >
        {isQueryEmpty(query)
          ? `Всего ${found}`
          : `Найдено ${found} из ${all.length}`}
      </p>

      {results.length > 0 ? (
        <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {results.map((solution) => (
            <li key={solution.id}>
              <SolutionCard
                solution={solution}
                categoryTitles={categoryTitles}
                industryTitles={industryTitles}
              />
            </li>
          ))}
        </ul>
      ) : (
        <Card className="mt-4 flex flex-col items-center px-6 py-14 text-center">
          <span className="glass text-muted grid size-12 place-items-center rounded-full">
            <Icon name="search" />
          </span>
          <h2 className="text-h3 mt-5 font-semibold">Ничего не найдено</h2>
          <p className="text-small text-muted mt-2 max-w-sm">
            Попробуйте изменить запрос или убрать часть фильтров.
          </p>
          <ButtonLink
            href="/catalog"
            variant="secondary"
            className="mt-6"
            scroll={false}
          >
            Сбросить фильтры
          </ButtonLink>
        </Card>
      )}
    </Section>
  );
}
