"use client";

import { useEffect } from "react";

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Появление блоков [data-reveal] при прокрутке. Скрывать их начинаем только
 * после запуска скрипта (класс reveal-ready на <html>): без JavaScript и при
 * reduced-motion всё видно сразу.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (reducedMotion() || typeof IntersectionObserver === "undefined") return;
    const root = document.documentElement;
    const items = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    // Что уже в окне при загрузке, не прячем — без мигания.
    const fold = window.innerHeight;
    for (const el of items) {
      if (el.getBoundingClientRect().top < fold) el.classList.add("is-visible");
    }
    root.classList.add("reveal-ready");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-visible");
          observer.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    items
      .filter((el) => !el.classList.contains("is-visible"))
      .forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      root.classList.remove("reveal-ready");
    };
  }, []);
  return null;
}

/**
 * Глубина первого экрана: при прокрутке телефон с перепиской уходит вверх
 * быстрее окна панели. Только широкий экран и без reduced-motion; GSAP
 * загружается отдельным файлом, когда браузер свободен.
 */
export function HeroParallax() {
  useEffect(() => {
    if (reducedMotion() || !window.matchMedia("(min-width: 1024px)").matches)
      return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    const start = async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {
        const scroll = {
          trigger: "#hero",
          start: "top top",
          end: "bottom top",
          scrub: 0.6,
        };
        gsap.to("[data-parallax='front']", {
          yPercent: -14,
          ease: "none",
          scrollTrigger: scroll,
        });
        gsap.to("[data-parallax='back']", {
          yPercent: -4,
          ease: "none",
          scrollTrigger: scroll,
        });
      });
      cleanup = () => ctx.revert();
    };
    const hasIdle = typeof window.requestIdleCallback === "function";
    const idle = hasIdle
      ? window.requestIdleCallback(() => void start())
      : window.setTimeout(() => void start(), 200);
    return () => {
      cancelled = true;
      if (hasIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      cleanup?.();
    };
  }, []);
  return null;
}
