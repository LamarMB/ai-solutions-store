"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  AI_NOTE,
  getScreen,
  overviewSteps,
  type OverviewStep,
} from "@/content/product-map";
import { cn } from "@/lib/cn";
import { onListKeyDown } from "./hooks";
import { LiveTitle } from "./parts";
import { ScreenView } from "./ScreenView";
import { StatusBadge } from "./StatusBadge";

const STEPS: readonly OverviewStep[] = overviewSteps;

/**
 * Короткая карта для главной: пять ключевых шагов, экран демо выбранного шага
 * и переход к подробной карте. Будущих функций здесь нет.
 */
export function ProductOverview({ detailsHref }: { detailsHref: string }) {
  const [active, select] = useState(0);
  const step = STEPS[active];
  const screen = getScreen(step.screenId);

  return (
    <div className="theme-product-map pm-canvas rounded-panel border-border border p-4 sm:p-6 lg:p-8">
      <LiveTitle text={`Шаг ${active + 1}: ${step.title}`} />
      <StatusBadge status="working" />

      <div className="relative mt-8">
        <span
          aria-hidden="true"
          className="pm-flow-line absolute inset-x-[10%] top-7 hidden h-px md:block"
        />
        <ol
          aria-label="Как работает система"
          className="relative grid gap-3 md:grid-cols-5"
          onKeyDown={(e) => onListKeyDown(e, STEPS.length, select)}
        >
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                data-index={i}
                aria-current={i === active ? "step" : undefined}
                onClick={() => select(i)}
                className="pm-step group flex w-full items-center gap-3 rounded-2xl p-2 text-left md:flex-col md:text-center"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "pm-node-icon grid size-14 shrink-0 place-items-center rounded-full",
                    i < active && "pm-step-done",
                  )}
                >
                  <Icon name={s.icon} size={22} />
                </span>
                <span>
                  <span className="text-caption text-muted block tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-small text-ink block font-semibold">
                    {s.title}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div
        key={step.id}
        className="pm-fade border-border mt-8 grid gap-8 border-t pt-8 lg:grid-cols-[1fr_1fr] lg:items-center"
      >
        <div>
          <p className="text-caption text-accent font-semibold tracking-wide uppercase">
            Шаг {active + 1} из {STEPS.length}
          </p>
          <h3 className="text-h2 mt-2 font-semibold">{step.title}</h3>
          <p className="mt-4 max-w-prose">{step.text}</p>
          {step.id === "o2" && (
            <p className="text-small text-muted mt-4 max-w-prose">{AI_NOTE}</p>
          )}
          <a
            href={detailsHref}
            className="text-small text-accent hover:text-accent-hover mt-6 inline-flex items-center gap-2 font-medium"
          >
            Подробная карта системы и внедрения
            <Icon name="arrow-right" size={16} />
          </a>
        </div>
        {screen && <ScreenView key={screen.id} screen={screen} />}
      </div>
    </div>
  );
}
