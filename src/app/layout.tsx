import type { Metadata, Viewport } from "next";
import { onest } from "@/app/fonts";
import { DemoBar } from "@/components/layout/DemoBar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SkipLink } from "@/components/ui/SkipLink";
import { getSeoConfig, OG_IMAGE, robotsFor } from "@/lib/seo";
import { site } from "@/lib/site";
import "./globals.css";

const seo = getSeoConfig();

export const metadata: Metadata = {
  metadataBase: seo.baseUrl,
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
  applicationName: site.name,
  // Страницы задают robots сами (pageMetadata). Здесь — только запрет для демо-режима:
  // на 404 Next.js добавляет свой noindex, и разрешающий тег рядом с ним противоречил бы.
  robots: seo.indexing ? undefined : robotsFor(false, seo),
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: site.name,
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", images: [OG_IMAGE] },
  // Номера и адреса в демо-текстах не должны превращаться в ссылки.
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#050506",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={onest.variable}>
      <body className="flex min-h-dvh flex-col">
        <SkipLink />
        <DemoBar />
        <SiteHeader />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
