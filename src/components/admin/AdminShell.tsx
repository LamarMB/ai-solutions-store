"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/components/admin/client";
import { ToastProvider } from "@/components/admin/ui";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin", label: "Главная", icon: "chart" },
  { href: "/admin/bookings", label: "Записи", icon: "calendar" },
  { href: "/admin/doctors", label: "Врачи", icon: "users" },
  { href: "/admin/schedule", label: "Расписание", icon: "clock" },
  { href: "/admin/settings", label: "Настройки", icon: "wrench" },
];

/** Каркас панели: меню слева на компьютере, вкладки сверху на телефоне. */
export function AdminShell({
  login,
  children,
}: {
  login: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const active = (href: string) =>
    href === "/admin" ? pathname === href : pathname.startsWith(href);

  async function logout() {
    setLeaving(true);
    await api("logout", { method: "POST", body: {} }).catch(() => {});
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <aside className="glass-bar border-border sticky top-0 z-30 border-b lg:h-dvh lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 lg:py-6">
            <div>
              <p className="font-semibold">Панель клиники</p>
              <p className="text-caption text-muted">Демо-Мед · демо-данные</p>
            </div>
            <button
              type="button"
              onClick={logout}
              disabled={leaving}
              className="text-small text-muted hover:text-ink lg:hidden"
            >
              Выйти
            </button>
          </div>
          <nav
            aria-label="Разделы панели"
            className="overflow-x-auto px-2 pb-2 lg:px-3"
          >
            <ul className="flex gap-1 lg:flex-col">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active(item.href) ? "page" : undefined}
                    className={cn(
                      "rounded-field text-small flex items-center gap-2.5 px-3 py-2 font-medium whitespace-nowrap transition-colors",
                      active(item.href)
                        ? "bg-accent-soft text-ink"
                        : "text-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="border-border mt-auto hidden border-t px-5 py-4 lg:block">
            <p className="text-caption text-muted">Вы вошли как</p>
            <p className="text-small truncate font-medium">{login}</p>
            <button
              type="button"
              onClick={logout}
              disabled={leaving}
              className="text-small text-muted hover:text-ink mt-2"
            >
              Выйти из панели
            </button>
          </div>
        </aside>
        <main
          id="main"
          className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10"
        >
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
