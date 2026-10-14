import type { Metadata } from "next";
import { getCategories, getIndustries, getSolutions } from "@/catalog";
import { SolutionCard } from "@/components/catalog/SolutionCard";
import { CtaPanel } from "@/components/marketing/CtaPanel";
import { DirectionGrid } from "@/components/marketing/DirectionGrid";
import { HeroShowcase } from "@/components/marketing/HeroShowcase";
import { PrincipleGrid } from "@/components/marketing/PrincipleGrid";
import { ProcessSteps } from "@/components/marketing/ProcessSteps";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { headerActions, mainNav } from "@/config/navigation";
import { principles, processSteps } from "@/content/approach";
import { directions } from "@/content/directions";
import { absoluteUrl, getSeoConfig, jsonLd, pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Внедрение ИИ и автоматизация бизнеса — AI Solutions Store",
  description:
    "Каталог решений по внедрению искусственного интеллекта в бизнес: ИИ-ассистенты, обработка документов, ИИ для бухгалтерии, медицинских клиник, продаж и HR. Состав работ, цена и ограничения.",
  path: "/",
  absoluteTitle: true,
});

const FEATURED_COUNT = 3;

export default function Home() {
  const featured = getSolutions().slice(0, FEATURED_COUNT);
  const categoryTitles = new Map(getCategories().map((c) => [c.id, c.title]));
  const industryTitles = new Map(getIndustries().map((i) => [i.id, i.title]));

  const config = getSeoConfig();
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: absoluteUrl("/", config),
    description: site.description,
    inLanguage: "ru-RU",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(website) }}
      />
      {/* Первый экран */}
      <section aria-labelledby="hero-title" className="overflow-hidden">
        <Container className="grid items-center gap-16 pt-14 pb-20 md:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:pt-24 lg:pb-28">
          <div>
            <p className="glass text-caption text-muted inline-flex items-center gap-2 rounded-full px-3 py-1.5">
              <Icon name="sparkle" size={14} className="text-accent" />
              ИИ и автоматизация для бизнеса
            </p>
            <h1
              id="hero-title"
              className="text-display mt-6 font-semibold text-balance"
            >
              Внедрение ИИ в&nbsp;процессы бизнеса
            </h1>
            <p className="text-h3 text-muted mt-6 max-w-xl font-normal">
              Решения с понятным составом работ, ценой и ограничениями. Выберите
              подходящее в каталоге или подберите вместе с ИИ-консультантом.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href={mainNav[0].href} size="lg">
                Смотреть решения
                <Icon name="arrow-right" size={18} />
              </ButtonLink>
              <ButtonLink
                href={headerActions.consultant.href}
                variant="secondary"
                size="lg"
              >
                <Icon name="chat" size={18} />
                {headerActions.consultant.label}
              </ButtonLink>
            </div>
            <p className="text-caption text-muted mt-6">
              Демо-версия: решения, цены и сроки на сайте демонстрационные.
            </p>
          </div>
          <div className="pt-10 lg:pt-0">
            <HeroShowcase />
          </div>
        </Container>
      </section>

      <Section
        aria-labelledby="directions-title"
        className="py-10 md:py-12 xl:py-14"
      >
        <SectionHeading
          id="directions-title"
          eyebrow="Направления"
          title="Популярные направления"
          text="Отрасли и задачи, для которых в каталоге есть решения. Каждое направление открывает каталог с нужным фильтром."
          action={
            <ButtonLink href="/industries" variant="secondary" size="sm">
              Все отрасли
            </ButtonLink>
          }
        />
        <div className="mt-8">
          <DirectionGrid items={directions} />
        </div>
      </Section>

      <Section
        aria-labelledby="featured-title"
        className="py-10 md:py-12 xl:py-14"
      >
        <SectionHeading
          id="featured-title"
          eyebrow="Каталог"
          title="Решения из каталога"
          text="Демонстрационные примеры того, как решения описаны в каталоге: пакеты, стоимость, сроки и ограничения."
          action={
            <ButtonLink href={mainNav[0].href} variant="secondary" size="sm">
              Весь каталог
              <Icon name="arrow-right" size={16} />
            </ButtonLink>
          }
        />
        <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featured.map((solution) => (
            <li key={solution.id}>
              <SolutionCard
                solution={solution}
                categoryTitles={categoryTitles}
                industryTitles={industryTitles}
                headingLevel="h3"
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        aria-labelledby="process-title"
        className="py-10 md:py-12 xl:py-14"
      >
        <SectionHeading
          id="process-title"
          eyebrow="Процесс"
          title="Как мы работаем"
          text="Четыре шага от задачи до работающего решения."
          action={
            <ButtonLink href="/how-we-work" variant="secondary" size="sm">
              Подробнее о процессе
            </ButtonLink>
          }
        />
        <div className="mt-8">
          <ProcessSteps steps={processSteps} />
        </div>
      </Section>

      <Section
        aria-labelledby="principles-title"
        className="py-10 md:py-12 xl:py-14"
      >
        <SectionHeading
          id="principles-title"
          eyebrow="Подход"
          title="Почему так удобнее выбирать"
          text="Принципы, по которым устроен каталог и работа над внедрением."
        />
        <div className="mt-10">
          <PrincipleGrid items={principles} />
        </div>
      </Section>

      <Section aria-label="Начать" className="pt-8 pb-20 md:pb-24 xl:pb-28">
        <CtaPanel />
      </Section>
    </>
  );
}
