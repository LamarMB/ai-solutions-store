import type { Metadata } from "next";
import Link from "next/link";
import { getIndustries, getSolutions } from "@/catalog";
import { solutionHref } from "@/catalog/links";
import {
  catalogHref,
  EMPTY_QUERY,
  filterSolutions,
  pluralRu,
} from "@/catalog/search";
import { CtaPanel } from "@/components/marketing/CtaPanel";
import { ButtonLink } from "@/components/ui/Button";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";
import { industryIcons } from "@/content/directions";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "ИИ-решения по отраслям",
  description:
    "Автоматизация и ИИ для медицинских клиник, ресторанов, розницы, логистики, производства, услуг и образования: отраслевые и универсальные решения каталога.",
  path: "/industries",
});

export default function IndustriesPage() {
  const solutions = getSolutions();

  return (
    <Section className="pt-8 md:pt-12 xl:pt-14">
      <Breadcrumbs
        items={[{ label: "Главная", href: "/" }, { label: "Отрасли" }]}
      />
      <header className="mt-8 max-w-prose">
        <h1 className="text-h1 font-semibold">Отрасли</h1>
        <p className="text-muted mt-4">
          Выберите отрасль, чтобы открыть каталог с подходящими решениями. В
          подборку входят и универсальные решения, применимые в любой отрасли.
        </p>
        <p className="text-caption text-muted mt-3">
          Решения и цены в каталоге — демонстрационные.
        </p>
      </header>

      <ul className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {getIndustries().map((industry) => {
          const query = { ...EMPTY_QUERY, industries: [industry.id] };
          const matching = filterSolutions(solutions, query);
          // Универсальные решения одинаковы для всех отраслей — их только считаем.
          const specific = matching.filter((s) => s.industryIds.length > 0);
          const universalCount = matching.length - specific.length;
          const titleId = `industry-${industry.id}`;
          return (
            <li key={industry.id}>
              <Card
                className="flex h-full flex-col"
                role="article"
                aria-labelledby={titleId}
              >
                <span className="glass text-accent grid size-11 place-items-center rounded-full">
                  <Icon
                    name={industryIcons[industry.id] ?? "layers"}
                    size={20}
                  />
                </span>
                <h2 id={titleId} className="text-h3 mt-5 font-semibold">
                  {industry.title}
                </h2>
                <p className="text-small text-muted mt-2">
                  {industry.description}
                </p>

                <div className="border-border mt-5 mb-6 border-t pt-4">
                  <p className="text-caption text-muted">
                    {matching.length}{" "}
                    {pluralRu(matching.length, [
                      "решение",
                      "решения",
                      "решений",
                    ])}{" "}
                    в демо-каталоге
                  </p>
                  {specific.length > 0 && (
                    <ul className="mt-3 grid gap-2">
                      {specific.map((solution) => (
                        <li key={solution.id}>
                          <Link
                            href={solutionHref(solution.id)}
                            className="text-small hover:text-accent inline-flex gap-2 rounded-sm transition-colors"
                          >
                            <Icon
                              name="chevron-right"
                              size={16}
                              className="text-muted mt-0.5 shrink-0"
                            />
                            <span>{solution.title}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {universalCount > 0 && (
                    <p className="text-small text-muted mt-3">
                      {specific.length > 0 ? "И ещё " : ""}
                      {universalCount}{" "}
                      {pluralRu(universalCount, [
                        "универсальное решение",
                        "универсальных решения",
                        "универсальных решений",
                      ])}{" "}
                      для любой отрасли
                    </p>
                  )}
                </div>

                <ButtonLink
                  href={catalogHref(query)}
                  variant="secondary"
                  size="sm"
                  className="mt-auto self-start"
                >
                  Смотреть в каталоге
                  <span className="sr-only">— {industry.title}</span>
                  <Icon name="arrow-right" size={16} />
                </ButtonLink>
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="mt-20">
        <CtaPanel
          title="Не нашли свою отрасль?"
          text="Многие решения не привязаны к отрасли. Посмотрите весь каталог или оставьте заявку — обсудим задачу."
        />
      </div>
    </Section>
  );
}
