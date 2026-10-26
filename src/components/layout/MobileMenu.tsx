"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { buttonClasses } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { headerActions, isActivePath, mainNav } from "@/config/navigation";
import { externalLinkProps } from "@/config/contact";
import { cn } from "@/lib/cn";

/**
 * Мобильное меню на нативном <dialog>: модальность, ловушка фокуса и Esc
 * обеспечивает браузер; прокрутку страницы блокирует правило в globals.css.
 */
export function MobileMenu() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  const open = () => dialogRef.current?.showModal();
  const close = () => dialogRef.current?.close();

  // На широком экране меню скрыто — закрываем, чтобы страница не осталась инертной.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) dialogRef.current?.close();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-controls="mobile-menu"
        className={buttonClasses({ variant: "secondary", size: "icon" })}
      >
        <Icon name="menu" size={20} />
        <span className="sr-only">Открыть меню</span>
      </button>

      <dialog
        id="mobile-menu"
        ref={dialogRef}
        aria-label="Меню сайта"
        className="bg-bg/92 text-ink m-0 h-dvh max-h-none w-full max-w-none p-0 backdrop-blur-xl backdrop:bg-transparent"
      >
        <div className="flex h-full flex-col">
          <div className="border-border flex h-16 items-center justify-between border-b px-4 sm:px-6">
            <span className="font-semibold tracking-tight">Меню</span>
            <button
              type="button"
              onClick={close}
              className={buttonClasses({ variant: "secondary", size: "icon" })}
            >
              <Icon name="close" size={20} />
              <span className="sr-only">Закрыть меню</span>
            </button>
          </div>

          <nav
            aria-label="Основная"
            className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
          >
            <ul className="flex flex-col">
              {mainNav.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href} className="border-border border-b">
                    <Link
                      href={item.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "text-h3 flex items-center justify-between py-4 font-medium",
                        active ? "text-accent" : "text-ink",
                      )}
                    >
                      {item.label}
                      <Icon name="chevron-right" className="text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-border grid gap-3 border-t px-4 py-5 sm:px-6">
            <Link
              href={headerActions.demo.href}
              onClick={close}
              {...externalLinkProps}
              className={buttonClasses({ size: "lg" })}
            >
              {headerActions.demo.label}
            </Link>
            <Link
              href={headerActions.consultant.href}
              onClick={close}
              className={buttonClasses({ variant: "secondary", size: "lg" })}
            >
              <Icon name="chat" size={18} />
              {headerActions.consultant.label}
            </Link>
          </div>
        </div>
      </dialog>
    </>
  );
}
