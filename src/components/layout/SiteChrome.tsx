import type { ReactNode } from "react";
import { DemoBar } from "@/components/layout/DemoBar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SkipLink } from "@/components/ui/SkipLink";

/**
 * Демо-полоса, шапка и подвал публичного сайта вокруг содержимого страницы.
 * Класс theme-site включает тему сайта (globals.css); панель и Mini App — без неё.
 */
export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <div className="theme-site flex flex-1 flex-col">
      <SkipLink />
      <DemoBar />
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
