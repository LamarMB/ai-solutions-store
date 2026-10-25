import type { ReactNode } from "react";
import { DemoBar } from "@/components/layout/DemoBar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SkipLink } from "@/components/ui/SkipLink";

/** Демо-полоса, шапка и подвал публичного сайта вокруг содержимого страницы. */
export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <DemoBar />
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
