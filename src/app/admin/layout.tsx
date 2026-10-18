import type { Metadata } from "next";

/** Админ-панель закрыта от поисковиков всегда, независимо от настроек сайта. */
export const metadata: Metadata = {
  title: { default: "Панель клиники", template: "%s · Панель клиники" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
