"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { overviewSteps } from "@/content/product-map";
import { cn } from "@/lib/cn";
import { demoCaption, DemoShot } from "./Frames";

/**
 * Путь пациента из пяти шагов (данные карты продукта, overviewSteps).
 * Широкий экран: шаги слева, справа закреплённый экран демо, который
 * сменяется по мере прокрутки. Узкий экран: экран под каждым шагом, без
 * закрепления. Без JavaScript видны все шаги и первый экран.
 */
export function PatientPath({ detailsHref }: { detailsHref: string }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const items = refs.current.filter(Boolean) as HTMLLIElement[];
    if (typeof IntersectionObserver === "undefined") return;
    // Активен шаг, пересекающий середину окна.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting)
            setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const n = overviewSteps.length;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
      {/* Узкий экран: карточки «шаг + экран» листаются по горизонтали. */}
      <ol
        aria-label="Путь пациента"
        className="-mx-4 flex snap-x snap-mandatory [scrollbar-width:none] gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:hidden"
      >
        {overviewSteps.map((step, i) => (
          <li
            key={step.id}
            className="panel flex w-[84%] max-w-sm shrink-0 snap-center flex-col p-6"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="bg-accent text-accent-ink grid size-10 shrink-0 place-items-center rounded-full"
              >
                <Icon name={step.icon} size={18} />
              </span>
              <p className="text-caption text-muted font-medium tracking-[0.14em] uppercase tabular-nums">
                Шаг {String(i + 1).padStart(2, "0")} из{" "}
                {String(n).padStart(2, "0")}
              </p>
            </div>
            <h3 className="text-h3 mt-5 font-semibold">{step.title}</h3>
            <p className="text-small text-muted mt-2 text-pretty">
              {step.text}
            </p>
            <figure className="mt-auto pt-6">
              <DemoShot
                id={step.screenId}
                className="mx-auto max-w-[12.5rem] [&.frame-browser]:max-w-none"
                chatClassName="h-[15rem]"
              />
              <figcaption className="text-caption text-muted mt-3 text-center">
                {demoCaption([step.screenId])}
              </figcaption>
            </figure>
          </li>
        ))}
      </ol>

      {/* Широкий экран: шаги, экран активного шага — справа. */}
      <ol className="relative hidden lg:block">
        {/* Линия прогресса: заполняется до активного шага. */}
        <span
          aria-hidden="true"
          className="bg-border absolute top-2 bottom-2 left-[1.375rem] w-px"
        />
        <span
          aria-hidden="true"
          className="bg-accent absolute top-2 left-[1.375rem] w-px origin-top transition-[height] duration-500 ease-out"
          style={{ height: `calc(${((active + 1) / n) * 100}% - 1rem)` }}
        />
        {overviewSteps.map((step, i) => (
          <li
            key={step.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-index={i}
            aria-current={i === active ? "step" : undefined}
            className="relative flex min-h-[38vh] items-center"
          >
            <div className="flex gap-6">
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 grid size-11 shrink-0 place-items-center rounded-full border transition-colors duration-300",
                  i <= active
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-border-strong bg-bg text-muted",
                )}
              >
                <Icon name={step.icon} size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-caption text-muted font-medium tracking-[0.14em] uppercase tabular-nums">
                  Шаг {String(i + 1).padStart(2, "0")}
                </p>
                <h3
                  className={cn(
                    "mt-2 font-semibold transition-colors duration-300",
                    "text-[clamp(1.5rem,1.2rem+1vw,2.125rem)] leading-tight tracking-[-0.02em]",
                    i === active ? "text-ink" : "text-muted",
                  )}
                >
                  {step.title}
                </h3>
                <p className="text-lead text-muted mt-4 max-w-md text-pretty">
                  {step.text}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* Широкий экран: закреплённый экран активного шага. */}
      <div className="hidden lg:block">
        <div className="sticky top-28">
          <div className="panel relative grid h-[min(40rem,calc(100vh-9rem))] place-items-center overflow-hidden p-8">
            {overviewSteps.map((step, i) => (
              <div
                key={step.id}
                aria-hidden={i !== active}
                className={cn(
                  "absolute inset-8 grid place-items-center transition-[opacity,transform] duration-500 ease-out",
                  i === active
                    ? "opacity-100"
                    : "pointer-events-none translate-y-3 scale-[0.98] opacity-0",
                )}
              >
                <DemoShot
                  id={step.screenId}
                  className="w-full max-w-[17.5rem] [&.frame-browser]:max-w-none"
                  chatClassName="h-[28rem]"
                />
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-caption text-muted" aria-live="polite">
              {overviewSteps[active].title} ·{" "}
              {demoCaption([overviewSteps[active].screenId])}
            </p>
            <Link
              href={detailsHref}
              className="text-small text-accent hover:text-accent-hover inline-flex items-center gap-1.5 font-medium"
            >
              Подробная карта системы
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </div>
      </div>
      <Link
        href={detailsHref}
        className="text-small text-accent inline-flex items-center gap-1.5 font-medium lg:hidden"
      >
        Подробная карта системы
        <Icon name="arrow-right" size={16} />
      </Link>
    </div>
  );
}
