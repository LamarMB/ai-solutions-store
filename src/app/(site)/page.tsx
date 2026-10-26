import type { Metadata } from "next";
import { getSolutionById, getSolutions } from "@/catalog";
import { solutionHref } from "@/catalog/links";
import { Benefits } from "@/components/home/Benefits";
import { DemoSection } from "@/components/home/DemoSection";
import { Faq } from "@/components/home/Faq";
import { Hero } from "@/components/home/Hero";
import { MobileDemoBar } from "@/components/home/MobileDemoBar";
import {
  HeroParallax,
  HeroPause,
  RevealOnScroll,
} from "@/components/home/Motion";
import { PatientPath } from "@/components/home/PatientPath";
import { Pricing } from "@/components/home/Pricing";
import { SectionIntro } from "@/components/home/SectionIntro";
import { SetupStrip } from "@/components/home/SetupStrip";
import { StaffPanel } from "@/components/home/StaffPanel";
import { Trust } from "@/components/home/Trust";
import { Container } from "@/components/ui/Container";
import {
  MAP_ANCHOR,
  PRODUCT_MAP_SOLUTION_ID,
  SETUP_ANCHOR,
} from "@/content/product-map";
import { absoluteUrl, getSeoConfig, jsonLd, pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "ИИ-администратор для частных клиник — AI Solutions Store",
  description:
    "ИИ-администратор отвечает пациентам в сообщениях сообщества ВКонтакте и в приложении клиники, записывает на приём по расписанию из панели и передаёт вопросы администратору с разрешения пациента.",
  path: "/",
  absoluteTitle: true,
});

export default function Home() {
  const administrator = getSolutionById(PRODUCT_MAP_SOLUTION_ID);
  const concepts = getSolutions().filter((s) => s.maturity !== "demo");
  const productHref = solutionHref(PRODUCT_MAP_SOLUTION_ID);

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
      <Hero />
      <Benefits />

      <section
        id="path"
        aria-labelledby="path-title"
        className="border-border scroll-mt-20 border-y bg-[linear-gradient(180deg,var(--surface-soft),transparent_70%)] py-16 md:py-24 xl:py-28"
      >
        <Container>
          <SectionIntro
            id="path-title"
            eyebrow="Как это работает"
            title="Путь пациента: от сообщения до приёма"
            text="Пять шагов ИИ-администратора «Демо-Мед» — что видит пациент и что получают администратор и врач. Экраны из демо-версии с вымышленной клиникой."
          />
          <div className="mt-16">
            <PatientPath detailsHref={`${productHref}#${MAP_ANCHOR}`} />
          </div>
        </Container>
      </section>

      <StaffPanel />
      <Trust />
      <SetupStrip detailsHref={`${productHref}#${SETUP_ANCHOR}`} />
      {administrator && administrator.packages.length > 0 && (
        <Pricing solution={administrator} />
      )}
      <Faq />
      <DemoSection concepts={concepts} />

      <RevealOnScroll />
      <HeroParallax />
      <HeroPause />
      <MobileDemoBar />
    </>
  );
}
