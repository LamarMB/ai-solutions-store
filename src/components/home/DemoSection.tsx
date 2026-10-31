import Link from "next/link";
import type { Solution } from "@/catalog/schema";
import { solutionHref } from "@/catalog/links";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { MaturityBadge } from "@/components/ui/Badge";
import { externalLinkProps, telegram } from "@/config/contact";
import { demoContact } from "@/config/demo";
import { demoSection } from "@/content/home";
import { getRequestStore } from "@/requests/store";
import { DemoRequestForm } from "./DemoRequestForm";

/**
 * Раздел #demo. Кнопка ведёт в рабочий Telegram (src/config/demo.ts); без
 * контакта она неактивна и рядом сказано, что заявки через сайт не
 * принимаются. Ниже — модули в разработке с пометкой статуса.
 */
export function DemoSection({ concepts }: { concepts: Solution[] }) {
  // Форма — только когда заявки действительно доставляются (docs/requests.md).
  const formLive = getRequestStore().mode === "live";
  return (
    <section
      id="demo"
      aria-labelledby="demo-title"
      className="scroll-mt-24 pt-8 pb-24 md:pb-32"
    >
      <Container>
        <div
          data-reveal
          className="panel relative grid gap-12 overflow-hidden p-8 sm:p-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:p-16"
        >
          <div
            aria-hidden="true"
            className="hero-grid pointer-events-none absolute inset-0 opacity-70"
          />
          <div className="relative">
            <p className="eyebrow">Демонстрация</p>
            <h2
              id="demo-title"
              className="text-section mt-5 font-semibold text-balance"
            >
              {demoSection.title}
            </h2>
            <p className="text-lead text-muted mt-5 max-w-xl text-pretty">
              {demoSection.text}
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              {demoContact ? (
                <a
                  href={demoContact.href}
                  {...externalLinkProps}
                  aria-describedby="demo-contact-note"
                  className={buttonClasses({ size: "lg" })}
                >
                  <Icon name="send" size={18} />
                  {demoContact.label}
                </a>
              ) : (
                <Button size="lg" disabled aria-describedby="demo-pending">
                  Запросить демонстрацию
                </Button>
              )}
              <Link
                href={`${solutionHref("clinic-ai-administrator")}#product-map`}
                className={buttonClasses({ variant: "secondary", size: "lg" })}
              >
                Карта системы
              </Link>
            </div>
            {demoContact ? (
              <p
                id="demo-contact-note"
                className="text-small text-muted mt-5 flex max-w-xl items-start gap-2"
              >
                <Icon name="info" size={18} className="mt-0.5 shrink-0" />
                <span>
                  {formLive
                    ? demoSection.contactNoteLive
                    : demoSection.contactNote}{" "}
                  <a
                    href={demoContact.href}
                    {...externalLinkProps}
                    className="text-accent hover:text-accent-hover font-medium"
                  >
                    {telegram.handle}
                  </a>
                </span>
              </p>
            ) : (
              <p
                id="demo-pending"
                className="text-small text-muted mt-5 flex max-w-xl items-start gap-2"
              >
                <Icon name="info" size={18} className="mt-0.5 shrink-0" />
                {demoSection.pending}
              </p>
            )}
          </div>
          {formLive ? (
            <div className="relative self-center">
              <DemoRequestForm />
            </div>
          ) : (
            <ul className="relative space-y-4 self-center">
              {demoSection.points.map((point) => (
                <li
                  key={point}
                  className="border-border bg-bg/60 flex items-center gap-4 rounded-2xl border p-5"
                >
                  <Icon
                    name="check"
                    size={20}
                    className="text-accent shrink-0"
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {concepts.length > 0 && (
          <div className="border-border mt-16 border-t pt-10">
            <p className="eyebrow text-muted">Также в разработке</p>
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {concepts.map((s) => (
                <li key={s.id}>
                  <Link
                    href={solutionHref(s.id)}
                    className="border-border hover:border-border-strong group flex items-start justify-between gap-6 rounded-2xl border p-6 transition-colors"
                  >
                    <span>
                      <span className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold">{s.title}</span>
                        <MaturityBadge maturity={s.maturity} />
                      </span>
                      <span className="text-small text-muted mt-2 line-clamp-2 block">
                        {s.summary}
                      </span>
                    </span>
                    <Icon
                      name="arrow-right"
                      size={18}
                      className="text-muted group-hover:text-accent mt-1 shrink-0 transition-colors"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Container>
    </section>
  );
}
