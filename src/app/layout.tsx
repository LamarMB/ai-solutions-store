import type { Metadata, Viewport } from "next";
import { onest } from "@/app/fonts";
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
      {/* Шапка и подвал сайта — в app/(site)/layout.tsx; у админ-панели свой каркас. */}
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
