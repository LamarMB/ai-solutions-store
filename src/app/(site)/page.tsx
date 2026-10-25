import type { Metadata } from "next";
import {
  getCategories,
  getIndustries,
  getSolutionById,
  getSolutions,
} from "@/catalog";
import { SolutionCard } from "@/components/catalog/SolutionCard";
import { CtaPanel } from "@/components/marketing/CtaPanel";
import { DirectionGrid } from "@/components/marketing/DirectionGrid";
import { HeroShowcase } from "@/components/marketing/HeroShowcase";
import { PatientJourney } from "@/components/marketing/PatientJourney";
import { PrincipleGrid } from "@/components/marketing/PrincipleGrid";
import { ProcessSteps } from "@/components/marketing/ProcessSteps";
import { TariffGrid } from "@/components/marketing/TariffGrid";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { headerActions, mainNav } from "@/config/navigation";
import { principles, processSteps } from "@/content/approach";
import { directions } from "@/content/directions";
import { patientJourney } from "@/content/patient-journey";
import { absoluteUrl, getSeoConfig, jsonLd, pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "ИИ-решения для медицинских клиник — AI Solutions Store",
  description:
    "Автоматизируем общение с пациентами, запись на приём и обработку обращений в частных клиниках: ИИ-администратор, маршрутизация обращений, понятные тарифы.",
  path: "/",
  absoluteTitle: true,
});

const FEATURED_COUNT = 3;

export default function Home() {
  const featured = getSolutions().slice(0, FEATURED_COUNT);
  const categoryTitles = new Map(getCategories().map((c) => [c.id, c.title]));
  const industryTitles = new Map(getIndustries().map((i) => [i.id, i.title]));
  const administrator = getSolutionById("clinic-ai-administrator");

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
              ИИ для частных медицинских клиник
            </p>
            <h1
              id="hero-title"
              className="text-display mt-6 font-semibold text-balance"
            >
              ИИ-решения для медицинских клиник
            </h1>
            <p className="text-h3 text-muted mt-6 max-w-xl font-normal">
              Автоматизируем общение с пациентами, запись на приём и обработку
              обращений. Помогаем администраторам тратить меньше времени на
              рутину.
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
              Демо-версия сайта. Цены предварительные, до окончательного
              согласования.
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
          eyebrow="Задачи клиники"
          title="Что автоматизируем"
          text="Рутина администраторов и регистратуры, которую можно передать ИИ. Каждая задача ведёт к решению из каталога."
          action={
            <ButtonLink href={mainNav[0].href} variant="secondary" size="sm">
              Все решения
            </ButtonLink>
          }
        />
        <div className="mt-8">
          <DirectionGrid items={directions} />
        </div>
      </Section>

      {administrator && administrator.packages.length > 0 && (
        <Section
          id="tariffs"
          aria-labelledby="tariffs-title"
          className="scroll-mt-20 py-10 md:py-12 xl:py-14"
        >
          <SectionHeading
            id="tariffs-title"
            eyebrow="Тарифы"
            title={`Тарифы: ${administrator.title}`}
            text="Внедрение оплачивается один раз, обслуживание — ежемесячно. Каналы — сообщения сообщества и приложение клиники во ВКонтакте."
          />
          <div className="mt-8">
            <TariffGrid solution={administrator} />
          </div>
        </Section>
      )}

      <Section
        aria-labelledby="featured-title"
        className="py-10 md:py-12 xl:py-14"
      >
        <SectionHeading
          id="featured-title"
          eyebrow="Каталог"
          title="Решения для клиник"
          text="Возможности, тарифы, ограничения и требования к данным — на странице каждого решения. Планируемые модули помечены как концепции."
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
        aria-labelledby="journey-title"
        className="py-10 md:py-12 xl:py-14"
      >
        <SectionHeading
          id="journey-title"
          eyebrow="Будущая функциональность"
          title="Как будет выглядеть запись для пациента"
          text="Описание планируемого сценария. Сейчас на сайте нет записи на приём, а медицинские данные не собираются и не передаются."
        />
        <div className="mt-8">
          <PatientJourney steps={patientJourney} />
        </div>
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
          eyebrow="Безопасность"
          title="Безопасность и достоверность"
          text="Принципы, которых мы придерживаемся при работе с клиниками и данными пациентов."
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
