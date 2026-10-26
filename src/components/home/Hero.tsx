import type { CSSProperties } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { headerActions } from "@/config/navigation";
import { hero } from "@/content/home";
import { demoCaption, DemoShot } from "./Frames";

const HERO_SCREENS = ["admin-home", "chat-greeting"] as const;

const delay = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as CSSProperties;

/**
 * Первый экран: заголовок в два тона, каналы и композиция из настоящих экранов
 * демо — панель клиники и переписка с ботом. Заголовок и вводный текст не
 * анимируются: они видны сразу и не задерживают отрисовку (LCP).
 */
export function Hero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-title"
      className="relative overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="hero-grid pointer-events-none absolute inset-0"
      />
      <Container className="relative grid gap-10 pt-14 pb-20 sm:gap-16 sm:pt-20 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-center lg:gap-14 lg:pt-24 lg:pb-32">
        <div>
          <p className="eyebrow">{hero.eyebrow}</p>
          <h1
            id="hero-title"
            className="text-hero mt-6 font-semibold [hyphens:manual]"
          >
            {hero.title}
            <span className="text-muted block">{hero.accent}</span>
          </h1>
          <p className="text-lead text-muted mt-7 max-w-xl text-pretty">
            {hero.lead}
          </p>
          <div
            className="rise-in mt-10 flex flex-col gap-3 sm:flex-row"
            style={delay(160)}
          >
            <ButtonLink href={headerActions.demo.href} size="lg">
              {headerActions.demo.label}
              <Icon name="arrow-right" size={18} />
            </ButtonLink>
            <ButtonLink href="#path" variant="secondary" size="lg">
              Как это работает
            </ButtonLink>
          </div>
          <ul
            className="rise-in border-border mt-12 grid gap-4 border-t pt-7 sm:grid-cols-3"
            style={delay(240)}
          >
            {hero.channels.map((c) => (
              <li key={c.label} className="flex items-start gap-3">
                <span className="bg-accent-soft text-accent grid size-9 shrink-0 place-items-center rounded-xl">
                  <Icon name={c.icon} size={18} />
                </span>
                <span className="text-small text-ink/90 pt-1.5 leading-snug">
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-muted mt-6">{hero.note}</p>
        </div>

        <figure
          className="rise-in mx-auto w-full max-w-xl lg:max-w-none"
          style={delay(120)}
        >
          <div className="relative pt-16 pb-12 sm:pt-0 sm:pb-20">
            <div data-parallax="back" className="sm:ml-10 lg:ml-12">
              <DemoShot id="admin-home" priority />
            </div>
            <div
              data-parallax="front"
              className="absolute bottom-0 left-0 w-[52%] max-w-[15.5rem] sm:w-[44%]"
            >
              <DemoShot
                id="chat-greeting"
                chatClassName="h-[17rem] sm:h-[24rem]"
              />
            </div>
          </div>
          <figcaption className="text-caption text-muted mt-5 text-right sm:mt-6">
            Панель клиники и переписка с ботом · {demoCaption(HERO_SCREENS)}
          </figcaption>
        </figure>
      </Container>
    </section>
  );
}
