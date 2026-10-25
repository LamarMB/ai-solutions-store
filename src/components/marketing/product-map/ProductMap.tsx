"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  AI_NOTE,
  LANE_LABELS,
  MAP_ANCHOR,
  getScreen,
  mapNodes,
  plannedFeatures,
  setupStages,
  stageHash,
  type MapNode,
} from "@/content/product-map";
import { cn } from "@/lib/cn";
import { onListKeyDown, useAutoplay, useHashSelect, useInView } from "./hooks";
import { LANES, VIEW_H, VIEW_W, mapEdges, nodeStyle } from "./layout";
import { AutoplayButton, LiveTitle } from "./parts";
import { ScreenView } from "./ScreenView";
import { StatusBadge } from "./StatusBadge";

const NODES: readonly MapNode[] = mapNodes;
const NODE_IDS = NODES.map((n) => n.id);
const EDGES = mapEdges(NODES);
const STEP_MS = 6000;

/**
 * Подробная карта «Как работает система»: десять узлов на трёх дорожках,
 * плавные связи, подробности и экраны демо выбранного узла. На узком экране —
 * вертикальный список с подробностями под выбранным шагом.
 */
export function ProductMap() {
  const [active, setActiveRaw] = useState(0);
  const [screen, setScreen] = useState(0);
  const setActive = useCallback((index: number) => {
    setActiveRaw(index);
    setScreen(0);
  }, []);
  const { playing, start, stop } = useAutoplay(
    NODES.length,
    active,
    setActive,
    STEP_MS,
  );
  const select = useCallback(
    (index: number) => {
      stop();
      setActive(index);
    },
    [stop, setActive],
  );
  useHashSelect("map-", NODE_IDS, select, MAP_ANCHOR);
  const canvasRef = useRef<HTMLDivElement>(null);
  const inView = useInView(canvasRef);
  const node = NODES[active];

  const detail = (
    <NodeDetail
      node={node}
      index={active}
      screen={screen}
      setScreen={setScreen}
      onPrev={active > 0 ? () => select(active - 1) : undefined}
      onNext={active < NODES.length - 1 ? () => select(active + 1) : undefined}
    />
  );

  return (
    <div className="theme-product-map pm-canvas rounded-panel border-border border p-4 sm:p-6 lg:p-8">
      <LiveTitle text={`Шаг ${active + 1}: ${node.title}`} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="working" />
          <StatusBadge status="configurable" />
        </div>
        <AutoplayButton
          playing={playing}
          onStart={start}
          onStop={stop}
          stepKey={active}
          stepMs={STEP_MS}
        />
      </div>

      {/* Широкий экран: схема на трёх дорожках. */}
      <div className="mt-8 hidden lg:block">
        <div
          ref={canvasRef}
          data-inview={inView || undefined}
          className="pm-map relative aspect-[5/3]"
        >
          {LANES.map((lane, i) => (
            <div
              key={lane}
              aria-hidden="true"
              className={cn(
                "pm-lane rounded-card absolute inset-x-0",
                i % 2 === 1 && "pm-lane-alt",
              )}
              style={{
                top: `${(i / LANES.length) * 100}%`,
                height: `${100 / LANES.length}%`,
              }}
            >
              <span className="text-caption text-muted absolute top-2.5 left-3 font-semibold tracking-wide uppercase">
                {LANE_LABELS[lane]}
              </span>
            </div>
          ))}
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="absolute inset-0 size-full overflow-visible"
          >
            {EDGES.map((edge, i) => {
              const lit = edge.from === node.id || edge.to === node.id;
              return (
                <g key={edge.id}>
                  <path
                    d={edge.d}
                    pathLength={1}
                    className="pm-edge"
                    data-lit={lit || undefined}
                    style={{ animationDelay: `${i * 90}ms` }}
                  />
                  {lit && <path d={edge.d} className="pm-edge-flow" />}
                </g>
              );
            })}
          </svg>
          <ol
            aria-label="Схема: путь пациента и работа клиники"
            onKeyDown={(e) => onListKeyDown(e, NODES.length, select)}
          >
            {NODES.map((n, i) => (
              <li
                key={n.id}
                className="absolute w-[17.5%] -translate-x-1/2 -translate-y-1/2"
                style={nodeStyle(n.col, n.lane)}
              >
                <NodeButton
                  node={n}
                  index={i}
                  active={i === active}
                  onSelect={select}
                />
              </li>
            ))}
          </ol>
        </div>
        <div className="border-border mt-8 border-t pt-8">{detail}</div>
      </div>

      {/* Узкий экран: вертикальная лента, подробности под выбранным шагом. */}
      <ol
        aria-label="Путь пациента и работа клиники"
        className="pm-rail mt-6 grid gap-3 lg:hidden"
        onKeyDown={(e) => onListKeyDown(e, NODES.length, select)}
      >
        {NODES.map((n, i) => (
          <li key={n.id} className="relative pl-6">
            <NodeButton
              node={n}
              index={i}
              active={i === active}
              onSelect={select}
              showLane
            />
            {i === active && <div className="pt-5 pb-2">{detail}</div>}
          </li>
        ))}
      </ol>

      <section aria-labelledby="planned-title" className="mt-10">
        <div className="flex flex-wrap items-center gap-3">
          <h3 id="planned-title" className="text-h3 font-semibold">
            Что будет дальше
          </h3>
          <StatusBadge status="planned" />
        </div>
        <p className="text-small text-muted mt-2 max-w-prose">
          Этого пока нет в продукте. Каждую возможность оцениваем отдельно и не
          обещаем до готовности.
        </p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {plannedFeatures.map((f) => (
            <li
              key={f.id}
              className="rounded-card border-border-strong text-small border border-dashed p-4"
            >
              <p className="text-muted flex items-center gap-2 font-medium">
                <Icon name="clock" size={14} className="shrink-0" />В планах
              </p>
              <p className="text-ink mt-2 font-semibold">{f.title}</p>
              <p className="text-muted mt-1">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NodeButton({
  node,
  index,
  active,
  onSelect,
  showLane,
}: {
  node: MapNode;
  index: number;
  active: boolean;
  onSelect: (index: number) => void;
  showLane?: boolean;
}) {
  return (
    <button
      type="button"
      data-index={index}
      aria-current={active ? "step" : undefined}
      onClick={() => onSelect(index)}
      className="pm-node rounded-card bg-surface/95 flex w-full items-start gap-3 border p-3 text-left"
      style={{ "--i": index } as CSSProperties}
    >
      <span
        aria-hidden="true"
        className="pm-node-icon grid size-9 shrink-0 place-items-center rounded-full"
      >
        <Icon name={node.icon} size={18} />
      </span>
      <span className="min-w-0">
        <span className="text-caption text-muted block tabular-nums">
          {String(index + 1).padStart(2, "0")}
          {showLane && <> · {LANE_LABELS[node.lane]}</>}
        </span>
        <span className="text-small text-ink block leading-snug font-semibold">
          {node.title}
        </span>
        <span className="text-caption text-muted mt-0.5 block leading-snug">
          {node.summary}
        </span>
      </span>
    </button>
  );
}

function NodeDetail({
  node,
  index,
  screen,
  setScreen,
  onPrev,
  onNext,
}: {
  node: MapNode;
  index: number;
  screen: number;
  setScreen: (i: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const screens = node.screenIds.flatMap((id) => getScreen(id) ?? []);
  const current = screens[screen] ?? screens[0];
  const stages = setupStages.filter((s) => node.stageIds.includes(s.id));
  return (
    <div
      key={node.id}
      className="pm-fade grid gap-8 lg:grid-cols-[1.1fr_0.9fr]"
    >
      <div>
        <p className="text-caption text-accent font-semibold tracking-wide uppercase">
          Шаг {index + 1} из {NODES.length} · {LANE_LABELS[node.lane]}
        </p>
        <h3 className="text-h2 mt-2 font-semibold text-balance">
          {node.title}
        </h3>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusBadge status="working" />
          {node.setup && <StatusBadge status="configurable" />}
        </div>
        <p className="mt-5 max-w-prose">{node.text}</p>
        <ul className="mt-5 grid gap-2.5">
          {node.points.map((p) => (
            <li key={p} className="text-small text-muted flex gap-2.5">
              <Icon
                name="check"
                size={16}
                className="text-accent mt-0.5 shrink-0"
              />
              {p}
            </li>
          ))}
        </ul>
        {node.id === "a3" && (
          <p className="text-small border-pm-gold/30 text-ink mt-5 rounded-2xl border p-3">
            {AI_NOTE}
          </p>
        )}
        {node.setup && (
          <p className="text-small text-muted mt-5">
            <span className="text-pm-gold font-medium">Под вашу клинику:</span>{" "}
            {node.setup.charAt(0).toLowerCase() + node.setup.slice(1)}
            {stages.length > 0 && (
              <>
                {" "}
                — этап{stages.length > 1 ? "ы" : ""}{" "}
                {stages.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ", "}
                    <a
                      href={stageHash(s.id)}
                      className="text-accent hover:text-accent-hover underline-offset-4 hover:underline"
                    >
                      «{s.title}»
                    </a>
                  </span>
                ))}
              </>
            )}
            .
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={!onPrev}
            className="glass glass-hover rounded-control text-small inline-flex h-10 items-center gap-2 px-4 font-medium disabled:opacity-40"
          >
            <Icon name="arrow-right" size={16} className="rotate-180" />
            Назад
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext}
            className="glass glass-hover rounded-control text-small inline-flex h-10 items-center gap-2 px-4 font-medium disabled:opacity-40"
          >
            Дальше
            <Icon name="arrow-right" size={16} />
          </button>
        </div>
      </div>
      {current && (
        <div>
          {screens.length > 1 && (
            <div
              role="group"
              aria-label="Экраны демо"
              className="mb-4 flex flex-wrap justify-center gap-1.5"
            >
              {screens.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={s.id === current.id}
                  onClick={() => setScreen(i)}
                  className={cn(
                    "text-caption rounded-control border px-3 py-1.5 font-medium transition-colors",
                    s.id === current.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-muted hover:text-ink",
                  )}
                >
                  {s.title}
                </button>
              ))}
            </div>
          )}
          <ScreenView key={current.id} screen={current} />
        </div>
      )}
    </div>
  );
}
