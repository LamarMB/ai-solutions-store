import type { CSSProperties } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { headerActions } from "@/config/navigation";
import { hero } from "@/content/home";
import { cn } from "@/lib/cn";
import { HeroConsole } from "./HeroConsole";

const delay = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as CSSProperties;

/**
 * Первый экран: слева крупный заголовок с ярким акцентом, действия, функции и
 * каналы; справа — наклонная консоль, иллюстрация интерфейса продукта
 * (HeroConsole). Заголовок и вводный текст не анимируются — видны сразу (LCP).
 */
export function Hero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-title"
      className="hero-stage relative overflow-hidden"
    >
      <Wave />
      <Container className="relative grid gap-12 pt-10 pb-20 sm:pt-16 lg:min-h-[calc(100svh-6.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:content-center lg:gap-x-6 lg:gap-y-10 lg:pt-14 lg:pb-14">
        {/* Порядок на телефоне: вступление → иллюстрация → функции и каналы. */}
        <div className="relative z-10 lg:col-start-1 lg:row-start-1 lg:self-end">
          <p className="text-small text-muted inline-flex items-center gap-2 rounded-full border border-[color:var(--hc-line-strong)] bg-[rgb(7_17_13/0.6)] px-3 py-1.5">
            <span className="hc-pulse size-1.5 rounded-full bg-[var(--hc-bright)]" />
            {hero.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="mt-7 text-[clamp(2.5rem,0.5rem+3.5vw,4rem)] leading-[1.04] font-bold tracking-[-0.04em] [hyphens:manual] lg:whitespace-nowrap"
          >
            <span className="block">{hero.title}</span>
            <span className="block">
              {hero.accent}{" "}
              <span className="text-bright">{hero.highlight}</span>
            </span>
          </h1>
          <p className="text-lead text-muted mt-7 max-w-xl text-pretty">
            {hero.lead}
          </p>
          <div
            className="rise-in mt-9 flex flex-col gap-3 sm:flex-row"
            style={delay(120)}
          >
            <ButtonLink
              href={headerActions.demo.href}
              size="lg"
              className="btn-bright rounded-xl"
            >
              {headerActions.demo.label}
              <Icon name="arrow-right" size={18} />
            </ButtonLink>
            <ButtonLink
              href="#path"
              variant="ghost"
              size="lg"
              className="btn-outline rounded-xl hover:bg-transparent"
            >
              Как это работает
            </ButtonLink>
          </div>
        </div>

        <figure
          className="rise-in relative pt-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-0"
          style={delay(80)}
        >
          <HeroConsole />
          <figcaption className="text-caption text-muted relative z-10 mt-6 max-w-md lg:mt-14">
            {hero.visualNote}
          </figcaption>
        </figure>

        <div className="relative z-10 lg:col-start-1 lg:row-start-2 lg:self-start">
          <ul
            className="rise-in grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4"
            style={delay(220)}
          >
            {hero.features.map((f) => (
              <li key={f.title}>
                <Icon
                  name={f.icon}
                  size={26}
                  className="text-[color:var(--hc-bright)]"
                  strokeWidth={1.5}
                />
                <p className="text-small mt-3 font-semibold">{f.title}</p>
                <p className="text-caption text-muted mt-1">{f.text}</p>
              </li>
            ))}
          </ul>

          <div className="rise-in mt-10" style={delay(300)}>
            <p className="text-caption text-muted">Работает в каналах</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {hero.channels.map((c) => (
                <li
                  key={c.label}
                  className="text-caption flex items-center gap-2 rounded-xl border border-[color:var(--hc-line)] bg-[rgb(7_17_13/0.5)] px-2.5 py-1.5"
                >
                  <Icon
                    name={c.icon}
                    size={16}
                    className="text-[color:var(--hc-bright)]"
                  />
                  {c.label}
                </li>
              ))}
            </ul>
            <ul className="mt-5 flex flex-wrap gap-2">
              {hero.badges.map((b, i) => (
                <li
                  key={b}
                  className={cn(
                    "text-caption flex items-center gap-2 rounded-lg px-3 py-1.5",
                    i === 0
                      ? "text-ink/90 bg-[rgb(62_230_163/0.08)]"
                      : "border-demo-ink/25 bg-demo-bg/70 text-demo-ink border",
                  )}
                >
                  <Icon
                    name={i === 0 ? "shield" : "info"}
                    size={14}
                    className={i === 0 ? "text-[color:var(--hc-bright)]" : ""}
                  />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}

/** Декоративная «волна» из точек слева внизу. */
function Wave() {
  return (
    <svg
      aria-hidden="true"
      className="hc-wave pointer-events-none absolute bottom-0 left-0 h-[46%] w-[62%] opacity-80"
      viewBox="0 0 900 360"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="hc-wave-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#3ee6a3" stopOpacity="0" />
          <stop offset="0.35" stopColor="#3ee6a3" stopOpacity="0.55" />
          <stop offset="1" stopColor="#3ee6a3" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="hc-drift">
        <path d="M-40 250 C 140 170, 300 330, 480 240 S 820 150, 960 220" />
        <path
          d="M-40 275 C 160 200, 320 345, 500 262 S 830 180, 960 246"
          opacity="0.6"
        />
        <path
          d="M-40 300 C 180 235, 340 360, 520 286 S 840 212, 960 272"
          opacity="0.35"
        />
      </g>
    </svg>
  );
}
