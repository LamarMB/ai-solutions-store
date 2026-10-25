"use client";

import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

/**
 * «Показать за минуту»: шаги переключаются сами, пока пользователь не нажмёт
 * «Стоп» или не выберет шаг сам. Запускается только по кнопке.
 */
export function useAutoplay(
  count: number,
  active: number,
  setActive: (index: number) => void,
  intervalMs: number,
) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (active + 1 < count) setActive(active + 1);
      else setPlaying(false);
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [playing, active, count, intervalMs, setActive]);

  const start = useCallback(() => {
    setActive(0);
    setPlaying(true);
  }, [setActive]);
  const stop = useCallback(() => setPlaying(false), []);

  return { playing, start, stop };
}

/**
 * Ссылки вида `#map-a5` выбирают узел без дублирующихся id в разметке:
 * обработчик находит узел и прокручивает к секции.
 */
export function useHashSelect(
  prefix: string,
  ids: readonly string[],
  onSelect: (index: number) => void,
  sectionId: string,
) {
  useEffect(() => {
    const apply = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (!hash.startsWith(prefix)) return;
      const index = ids.indexOf(hash.slice(prefix.length));
      if (index < 0) return;
      onSelect(index);
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    };
    const frame = window.requestAnimationFrame(apply);
    window.addEventListener("hashchange", apply);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", apply);
    };
  }, [prefix, ids, onSelect, sectionId]);
}

/** Секция попала в область просмотра — один раз (для появления линий). */
export function useInView<T extends Element>(ref: RefObject<T | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Стрелки, Home и End переводят фокус и выбор между кнопками списка. */
export function onListKeyDown(
  event: KeyboardEvent<HTMLElement>,
  count: number,
  select: (index: number) => void,
) {
  const target = (event.target as HTMLElement).closest("[data-index]");
  if (!target) return;
  const active = Number(target.getAttribute("data-index"));
  const keys: Record<string, number> = {
    ArrowRight: active + 1,
    ArrowDown: active + 1,
    ArrowLeft: active - 1,
    ArrowUp: active - 1,
    Home: 0,
    End: count - 1,
  };
  if (!(event.key in keys)) return;
  event.preventDefault();
  const index = Math.min(count - 1, Math.max(0, keys[event.key]));
  select(index);
  event.currentTarget
    .querySelector<HTMLElement>(`[data-index="${index}"]`)
    ?.focus();
}
