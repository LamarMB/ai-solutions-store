"use client";

import { useCallback, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  SETUP_ANCHOR,
  mapNodes,
  nodeHash,
  setupStages,
  type SetupStage,
} from "@/content/product-map";
import { cn } from "@/lib/cn";
import { onListKeyDown, useAutoplay, useHashSelect } from "./hooks";
import { AutoplayButton, LiveTitle } from "./parts";

const STAGES: readonly SetupStage[] = setupStages;
const STAGE_IDS = STAGES.map((s) => s.id);
const STEP_MS = 6000;

/**
 * «Как проходит внедрение»: девять этапов с линией прогресса. Сроков нет —
 * они определяются по итогам обследования.
 */
export function SetupFlow() {
  const [active, setActive] = useState(0);
  const { playing, start, stop } = useAutoplay(
    STAGES.length,
    active,
    setActive,
    STEP_MS,
  );
  const select = useCallback(
    (index: number) => {
      stop();
      setActive(index);
    },
    [stop],
  );
  useHashSelect("setup-", STAGE_IDS, select, SETUP_ANCHOR);
  const stage = STAGES[active];
  const progress = (active / (STAGES.length - 1)) * 100;

  return (
    <div className="theme-product-map pm-canvas rounded-panel border-border border p-4 sm:p-6 lg:p-8">
      <LiveTitle text={`Этап ${active + 1}: ${stage.title}`} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small text-muted max-w-xl">
          Сроки каждого этапа определяются по итогам обследования клиники.
        </p>
        <AutoplayButton
          playing={playing}
          onStart={start}
          onStop={stop}
          stepKey={active}
          stepMs={STEP_MS}
        />
      </div>

      {/* Широкий экран: горизонтальная лента этапов. */}
      <div className="relative mt-10 hidden lg:block">
        <span
          aria-hidden="true"
          className="bg-border absolute inset-x-[5.5%] top-5 h-px"
        />
        <span
          aria-hidden="true"
          className="pm-track bg-accent absolute top-5 left-[5.5%] h-px"
          style={{ width: `${progress * 0.89}%` }}
        />
        <ol
          aria-label="Этапы внедрения"
          className="relative grid grid-cols-9 gap-2"
          onKeyDown={(e) => onListKeyDown(e, STAGES.length, select)}
        >
          {STAGES.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                data-index={i}
                aria-current={i === active ? "step" : undefined}
                onClick={() => select(i)}
                className="pm-stage group flex w-full flex-col items-center gap-3 rounded-2xl px-1 pb-2 text-center"
              >
                <span
                  className={cn(
                    "pm-stage-dot text-small grid size-10 place-items-center rounded-full border font-semibold tabular-nums",
                    i < active && "pm-stage-done",
                  )}
                >
                  {i + 1}
                </span>
                <span className="text-caption text-ink leading-snug font-medium">
                  {s.title}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="border-border mt-8 border-t pt-8">
          <StageDetail stage={stage} index={active} />
        </div>
      </div>

      {/* Узкий экран: вертикальный список. */}
      <ol
        aria-label="Этапы внедрения"
        className="pm-rail mt-6 grid gap-3 lg:hidden"
        onKeyDown={(e) => onListKeyDown(e, STAGES.length, select)}
      >
        {STAGES.map((s, i) => (
          <li key={s.id} className="relative pl-6">
            <button
              type="button"
              data-index={i}
              aria-current={i === active ? "step" : undefined}
              onClick={() => select(i)}
              className="pm-node rounded-card bg-surface/95 flex w-full items-center gap-3 border p-3 text-left"
            >
              <span
                className={cn(
                  "pm-stage-dot text-small grid size-9 shrink-0 place-items-center rounded-full border font-semibold tabular-nums",
                  i < active && "pm-stage-done",
                )}
              >
                {i + 1}
              </span>
              <span className="text-small text-ink font-semibold">
                {s.title}
              </span>
            </button>
            {i === active && (
              <div className="pt-5 pb-2">
                <StageDetail stage={s} index={i} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StageDetail({ stage, index }: { stage: SetupStage; index: number }) {
  const nodes = mapNodes.filter((n) =>
    (stage.nodeIds as readonly string[]).includes(n.id),
  );
  const columns = [
    { title: "Что делаем", items: stage.activities },
    { title: "Что нужно от клиники", items: stage.fromClinic },
    { title: "Результат", items: [stage.outcome] },
  ];
  return (
    <div key={stage.id} className="pm-fade">
      <p className="text-caption text-accent font-semibold tracking-wide uppercase">
        Этап {index + 1} из {STAGES.length}
      </p>
      <h3 className="text-h2 mt-2 flex items-center gap-3 font-semibold">
        <Icon name={stage.icon} size={24} className="text-accent shrink-0" />
        {stage.title}
      </h3>
      <p className="mt-4 max-w-prose">{stage.text}</p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {columns.map((c) => (
          <div
            key={c.title}
            className="rounded-card border-border bg-surface/70 border p-4"
          >
            <p className="text-small text-ink font-semibold">{c.title}</p>
            <ul className="mt-3 grid gap-2">
              {c.items.map((item) => (
                <li key={item} className="text-small text-muted flex gap-2">
                  <span
                    aria-hidden="true"
                    className="bg-accent mt-2 size-1.5 shrink-0 rounded-full"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {nodes.length > 0 && (
        <p className="text-small text-muted mt-5">
          <span className="text-ink font-medium">На карте системы:</span>{" "}
          {nodes.map((n, i) => (
            <span key={n.id}>
              {i > 0 && ", "}
              <a
                href={nodeHash(n.id)}
                className="text-accent hover:text-accent-hover underline-offset-4 hover:underline"
              >
                {n.title}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
