"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, mainNav } from "@/config/navigation";
import { cn } from "@/lib/cn";

/** Основная навигация для десктопа; отмечает текущий раздел. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="glass flex items-center gap-0.5 rounded-full p-1">
      {mainNav.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "text-small block rounded-full px-3.5 py-1.5 font-medium transition-colors duration-200",
                active
                  ? "bg-surface-2 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]"
                  : "text-muted hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
