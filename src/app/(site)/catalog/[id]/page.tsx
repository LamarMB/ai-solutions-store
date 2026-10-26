import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCategories,
  getIndustries,
  getSolutionById,
  getSolutions,
} from "@/catalog";
import { requestHref, solutionHref } from "@/catalog/links";
import { MATURITY_NOTES } from "@/catalog/maturity";
import { solutionSeoDescription, solutionSeoTitle } from "@/catalog/seo";
import { PackagePicker } from "@/components/catalog/PackagePicker";
import { ProductMap } from "@/components/marketing/product-map/ProductMap";
import { SetupFlow } from "@/components/marketing/product-map/SetupFlow";
import { Badge, DemoBadge, MaturityBadge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";
import {
  MAP_ANCHOR,
  PRODUCT_MAP_SOLUTION_ID,
  SETUP_ANCHOR,
} from "@/content/product-map";
import { pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return getSolutions().map((solution) => ({ id: solution.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/catalog/[id]">): Promise<Metadata> {
  const solution = getSolutionById((await params).id);
  if (!solution) return {};
  return pageMetadata({
    title: solutionSeoTitle(solution),
    description: solutionSeoDescription(solution),
    path: solutionHref(solution.id),
  });
}

export default async function SolutionPage({
  params,
}: PageProps<"/catalog/[id]">) {
  const solution = getSolutionById((await params).id);
  if (!solution) notFound();

  const categoryTitles = new Map(getCategories().map((c) => [c.id, c.title]));
  const industryTitles = new Map(getIndustries().map((i) => [i.id, i.title]));
  const maturityNote = MATURITY_NOTES[solution.maturity];
  // Интерактивная карта продукта есть только у ИИ-администратора.
  const hasProductMap = solution.id === PRODUCT_MAP_SOLUTION_ID;
  const overview = [
    { id: "audience-title", title: "Для кого", items: solution.audience },
    {
      id: "problems-title",
      title: "Какие задачи решает",
      items: solution.problems,
    },
    {
      id: "capabilities-title",
      title: "Возможности",
      items: solution.capabilities,
    },
  ].filter((block) => block.items.length > 0);
  const industries =
    solution.industryIds.length === 0
      ? "Для любой отрасли"
      : solution.industryIds.map((id) => industryTitles.get(id)).join(", ");

  return (
    <Section className="pt-8 md:pt-12 xl:pt-14">
      <Breadcrumbs
        items={[
          { label: "Главная", href: "/" },
          { label: "Каталог", href: "/catalog" },
          { label: solution.title },
        ]}
      />

      <header className="mt-8 max-w-3xl">
        <div className="flex flex-wrap gap-2">
          {solution.isDemo && <DemoBadge />}
          <MaturityBadge maturity={solution.maturity} />
          {solution.categoryIds.map((id) => (
            <Badge key={id}>{categoryTitles.get(id)}</Badge>
          ))}
        </div>
        <h1 className="text-h1 mt-5 font-semibold text-balance">
          {solution.title}
        </h1>
        <p className="text-h3 text-muted mt-4 font-normal">
          {solution.summary}
        </p>
        <p className="text-small text-muted mt-5">
          <span className="text-ink font-medium">Отрасли:</span> {industries}
        </p>
        {maturityNote && (
          <p
            role="note"
            className="rounded-card border-accent/40 bg-accent-soft/40 text-small text-ink mt-6 flex gap-3 border p-4"
          >
            <Icon
              name="shield"
              size={18}
              className="text-accent mt-0.5 shrink-0"
            />
            {maturityNote}
          </p>
        )}
      </header>

      <section aria-labelledby="about-title" className="mt-12">
        <h2 id="about-title" className="text-h2 font-semibold">
          Описание
        </h2>
        <p className="mt-4 max-w-prose">{solution.description}</p>
      </section>

      {overview.length > 0 && (
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {overview.map((block) => (
            <InfoList
              key={block.id}
              id={block.id}
              title={block.title}
              items={block.items}
            />
          ))}
        </div>
      )}

      {hasProductMap && (
        <section
          id={MAP_ANCHOR}
          aria-labelledby="product-map-title"
          className="mt-14 scroll-mt-24"
        >
          <h2 id="product-map-title" className="text-h2 font-semibold">
            Как работает система
          </h2>
          <p className="text-muted mt-2 max-w-prose">
            Путь пациента от первого сообщения до записи и работа персонала.
            Нажмите на шаг, чтобы увидеть подробности и экран демо-версии.
          </p>
          <div className="mt-6">
            <ProductMap />
          </div>
        </section>
      )}

      <section aria-labelledby="packages-title" className="mt-14">
        <h2 id="packages-title" className="text-h2 scroll-mt-28 font-semibold">
          Пакеты внедрения
        </h2>
        {solution.packages.length > 0 ? (
          <>
            <p className="text-small text-muted mt-2">
              Выберите пакет и оставьте заявку — мы уточним задачу и условия.
            </p>
            <div className="mt-6">
              <PackagePicker
                solution={solution}
                defaultPackageId={
                  (
                    solution.packages.find((p) => p.recommended) ??
                    solution.packages[0]
                  ).id
                }
              />
            </div>
          </>
        ) : (
          <Card className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-body font-semibold">Пакеты не сформированы</p>
              <p className="text-small text-muted mt-1 max-w-prose">
                Состав работ, сроки и стоимость определяются после обсуждения
                задачи. Цена — по запросу.
              </p>
            </div>
            <ButtonLink href={requestHref(solution.id)} className="shrink-0">
              Обсудить решение
              <Icon name="arrow-right" size={18} />
            </ButtonLink>
          </Card>
        )}
      </section>

      {hasProductMap ? (
        <section
          id={SETUP_ANCHOR}
          aria-labelledby="stages-title"
          className="mt-14 scroll-mt-24"
        >
          <h2 id="stages-title" className="text-h2 font-semibold">
            Как проходит внедрение
          </h2>
          <p className="text-muted mt-2 max-w-prose">
            От знакомства с клиникой до запуска и поддержки.
          </p>
          <div className="mt-6">
            <SetupFlow />
          </div>
        </section>
      ) : (
        <section aria-labelledby="stages-title" className="mt-14">
          <h2 id="stages-title" className="text-h2 font-semibold">
            Этапы внедрения
          </h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {solution.implementationStages.map((stage, index) => (
              <li key={stage.title}>
                <Card className="h-full">
                  <span
                    aria-hidden="true"
                    className="glass text-small grid size-9 place-items-center rounded-full font-semibold tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <h3 className="text-body mt-4 font-semibold">
                    <span className="sr-only">Этап {index + 1}. </span>
                    {stage.title}
                  </h3>
                  <p className="text-small text-muted mt-2">
                    {stage.description}
                  </p>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mt-14 grid gap-4 lg:grid-cols-3">
        <InfoList
          id="data-title"
          title="Какие данные нужны"
          items={solution.dataRequirements}
        />
        <InfoList
          id="access-title"
          title="Какие доступы потребуются"
          items={solution.accessRequirements}
        />
        <InfoList
          id="limits-title"
          title="Ограничения"
          items={solution.limitations}
        />
      </div>

      <div className="mt-14">
        <Link
          href="/catalog"
          className="text-small text-accent hover:text-accent-hover inline-flex items-center gap-2 rounded-full font-medium"
        >
          <Icon name="arrow-right" size={16} className="rotate-180" />
          Вернуться в каталог
        </Link>
      </div>
    </Section>
  );
}

function InfoList({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: readonly string[];
}) {
  return (
    <section aria-labelledby={id}>
      <Card className="h-full">
        <h2 id={id} className="text-h3 font-semibold">
          {title}
        </h2>
        <ul className="mt-4 grid gap-3">
          {items.map((item) => (
            <li key={item} className="text-small text-muted flex gap-2.5">
              <span
                aria-hidden="true"
                className="bg-accent mt-2 size-1.5 shrink-0 rounded-full"
              />
              {item}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
