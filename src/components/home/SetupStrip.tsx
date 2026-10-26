import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { setupStages } from "@/content/product-map";
import { SectionIntro } from "./SectionIntro";

/** Девять этапов внедрения кратко; подробности — на странице решения. */
export function SetupStrip({ detailsHref }: { detailsHref: string }) {
  return (
    <section aria-labelledby="setup-title" className="py-16 md:py-24 xl:py-28">
      <Container>
        <SectionIntro
          id="setup-title"
          eyebrow="Внедрение"
          title="От знакомства до запуска и поддержки"
          text="Сроки каждого этапа определяются по итогам обследования клиники."
          action={
            <Link
              href={detailsHref}
              className="text-small text-accent hover:text-accent-hover inline-flex min-h-11 items-center gap-1.5 font-medium"
            >
              Подробно об этапах
              <Icon name="arrow-right" size={16} />
            </Link>
          }
        />
        <ol className="border-border mt-14 grid border-t sm:grid-cols-2 lg:grid-cols-3">
          {setupStages.map((stage, i) => (
            <li
              key={stage.id}
              data-reveal
              className="border-border flex gap-5 border-b py-5 sm:py-7 sm:pr-8 lg:[&:nth-child(3n+2)]:border-x lg:[&:nth-child(3n+2)]:px-8 lg:[&:nth-child(3n+3)]:pl-8"
            >
              <span className="text-accent text-small pt-1 font-semibold tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-semibold">{stage.title}</h3>
                <p className="text-small text-muted mt-2 hidden text-pretty sm:block">
                  {stage.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
