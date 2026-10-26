"use client";

import { useEffect, useState } from "react";
import { buttonClasses } from "@/components/ui/Button";
import { headerActions } from "@/config/navigation";
import { externalLinkProps } from "@/config/contact";
import { cn } from "@/lib/cn";

/**
 * Закреплённая кнопка «Запросить демонстрацию» на узком экране: появляется
 * после первого экрана и прячется у раздела #demo и подвала.
 */
export function MobileDemoBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("hero");
    const demo = document.getElementById("demo");
    if (!hero || !demo || typeof IntersectionObserver === "undefined") return;
    const state = { hero: true, demo: false };
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === hero) state.hero = e.isIntersecting;
        if (e.target === demo) state.demo = e.isIntersecting;
      }
      setVisible(!state.hero && !state.demo);
    });
    observer.observe(hero);
    observer.observe(demo);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn(
        "glass-bar border-border fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] transition-transform duration-300 sm:hidden",
        visible ? "translate-y-0" : "pointer-events-none translate-y-full",
      )}
      aria-hidden={!visible}
    >
      <a
        href={headerActions.demo.href}
        {...externalLinkProps}
        tabIndex={visible ? 0 : -1}
        className={cn(buttonClasses({ size: "md" }), "w-full")}
      >
        {headerActions.demo.label}
      </a>
    </div>
  );
}
